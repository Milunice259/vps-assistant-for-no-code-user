#!/usr/bin/env python3
"""Prepare and optionally publish an owner-signed APK. Never holds signing keys."""
import argparse, base64, hashlib, json, os, pathlib, re, subprocess, tempfile, urllib.parse

REPO = 'Milunice259/vps-assistant-for-no-code-user'
ROOT = pathlib.Path(__file__).resolve().parents[2]
def run(args, **kw):
    return subprocess.check_output(args, text=True, **kw).strip()
def gh_api(path, method='GET', payload=None):
    cmd = ['gh', 'api', path, '--method', method]
    return json.loads(run(cmd + (['--input', '-'] if payload is not None else []), input=json.dumps(payload) if payload is not None else None, stderr=subprocess.PIPE))
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', required=True, type=pathlib.Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--cert-sha256', required=True)
    parser.add_argument('--notes-file', required=True, type=pathlib.Path)
    parser.add_argument('--publish', action='store_true', help='Publish verified assets, then advance the main update feed')
    args = parser.parse_args()
    if os.getenv('GITHUB_ACTIONS'):
        parser.error('Owner-side release operation; not public CI')
    if not re.fullmatch('[a-f0-9]{40}', args.source) or not re.fullmatch('[a-f0-9]{64}', args.cert_sha256):
        parser.error('Exact source SHA and owner-approved certificate SHA-256 required')
    apk = args.apk.resolve()
    assert apk.is_file() and 0 < apk.stat().st_size <= 500000, 'Invalid APK size'
    sdk = pathlib.Path(os.getenv('ANDROID_SDK_ROOT', os.getenv('ANDROID_HOME', '/usr/local/lib/android/sdk')))
    tools = pathlib.Path(os.getenv('ANDROID_BUILD_TOOLS', str(sdk / 'build-tools/35.0.0')))
    signature = run([str(tools/'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)])
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})', signature)
    assert certs == [args.cert_sha256], 'Owner certificate does not match signed APK'
    run([str(tools/'zipalign'), '-c', '4', str(apk)])
    badging = run([str(tools/'aapt2'), 'dump', 'badging', str(apk)])
    match = re.search(r"package: name='com\.vpscontrol\.widget' versionCode='(\d+)' versionName='(\d+\.\d+\.\d+)'", badging)
    assert match, 'Only stable package accepted; never publish a QA-signed/package APK'
    code, version = int(match[1]), match[2]
    assert "minSdkVersion:'29'" in badging and "targetSdkVersion:'35'" in badging, 'Unexpected supported SDK range'
    assert run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']) == args.source, 'Check out the exact reviewed source first'
    assert not run(['git', '-C', str(ROOT), 'status', '--porcelain', '--', 'android/app/src', 'android/app/res', 'android/app/AndroidManifest.xml', 'android/app/build.sh']), 'Tracked Android source changes present'
    notes = args.notes_file.read_text(encoding='utf-8').strip()
    assert len(notes) <= 1200 and '\0' not in notes, 'Release notes too long'
    name, tag = f'VPS-Control-Widget-{version}.apk', f'android-v{version}'
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    release = dict(packageName='com.vpscontrol.widget', versionCode=code, versionName=version, minSdk=29, size=apk.stat().st_size, sha256=digest, certSha256=args.cert_sha256, source=args.source, url=f'https://github.com/{REPO}/releases/download/{tag}/{name}', notes=notes)
    manifest = dict(schema=1, release=release)
    output = ROOT/'android/app/build/release'
    output.mkdir(parents=True, exist_ok=True)
    (output/'stable.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    destination = output/name
    if destination != apk:
        destination.write_bytes(apk.read_bytes())
    print(f'Prepared {name}: {apk.stat().st_size} bytes; SHA-256 {digest}')
    if not args.publish:
        print('Prepared only. Owner may review stable.json and rerun with --publish.')
        return
    # Check source is already in main and the update feed will advance monotonically.
    comparison = gh_api(f'repos/{REPO}/compare/{args.source}...main')
    assert comparison['status'] in {'identical', 'ahead'}, 'Reviewed Android source must be merged into main before publishing'
    current = None
    try:
        current = gh_api(f'repos/{REPO}/contents/android/releases/stable.json?ref=main')
    except subprocess.CalledProcessError as e:
        # A missing initial feed is allowed; authentication/network errors must not be hidden.
        if 'HTTP 404' not in str(getattr(e, 'stderr', '')):
            raise
    if current:
        old = json.loads(base64.b64decode(current['content']))['release']
        if old:
            assert old.get('certSha256') == args.cert_sha256, 'Stable certificate continuity violated'
            assert old['versionCode'] < code or old == release, 'Update feed would downgrade or replace a released version'
    # The GitHub CLI creates only a draft at first. Verify downloaded assets before publishing it.
    existing = subprocess.run(['gh', 'release', 'view', tag, '--repo', REPO, '--json', 'isDraft,tagName'], capture_output=True, text=True)
    if existing.returncode:
        assert 'not found' in existing.stderr.lower() or 'HTTP 404' in existing.stderr, 'Cannot inspect release; refusing to mutate'
        run(['gh', 'release', 'create', tag, str(destination), str(output/'stable.json'), '--repo', REPO, '--target', args.source, '--draft', '--title', f'VPS Control {version}', '--notes-file', str(args.notes_file.resolve())])
    # Never overwrite an asset or move an existing tag. Its exact signed bytes must already match.
    with tempfile.TemporaryDirectory(prefix='vps-release-verify-') as temp:
        run(['gh', 'release', 'download', tag, '--repo', REPO, '--pattern', name, '--pattern', 'stable.json', '--dir', temp])
        assert hashlib.sha256((pathlib.Path(temp)/name).read_bytes()).hexdigest() == digest, 'Published APK bytes differ'
        assert json.loads((pathlib.Path(temp)/'stable.json').read_text()) == manifest, 'Published metadata differs'
    tag_info = gh_api(f'repos/{REPO}/git/ref/tags/{tag}')['object']
    if tag_info['type'] == 'tag':
        tag_info = gh_api(f'repos/{REPO}/git/tags/{tag_info["sha"]}')['object']
    assert tag_info['type'] == 'commit' and tag_info['sha'] == args.source, 'Release tag points to another source'
    run(['gh', 'release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest=false'])
    data = dict(message=f'Publish Android update feed for {tag}', branch='main', content=base64.b64encode((output/'stable.json').read_bytes()).decode())
    if current:
        data['sha'] = current['sha']
    gh_api(f'repos/{REPO}/contents/android/releases/stable.json', 'PUT', data)
    result = gh_api(f'repos/{REPO}/contents/android/releases/stable.json?ref=main')
    assert json.loads(base64.b64decode(result['content'])) == manifest, 'Update feed readback differs'
    print(f'Published {tag}; verified APK and main update feed. No signing secret uploaded.')
if __name__ == '__main__':
    main()
