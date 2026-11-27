#!/usr/bin/env python3
"""Temporary public-APK verification/publishing tools; no key access or host installation."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, urllib.request, zipfile
TOOLS = (
 ('jdk.tar.gz','https://aka.ms/download-jdk/microsoft-jdk-21.0.13.1-linux-x64.tar.gz','103575ed91ff84647f9f5630b94bc5d172faf95432633e77d54343f13bbd0362'),
 ('buildtools.zip','https://dl.google.com/android/repository/build-tools_r35_linux.zip','bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88'),
)
PUBLISHER_SHA='628cbb09a1eb13713cb8ef5bed0953acda8205e7dedb684a49a487907d8656bb'
def destination(root, name):
    target=(root/name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Archive path leaves the temporary tool directory')
    return target

def unpack(path, root):
    root.mkdir(parents=True,exist_ok=True)
    if path.suffix=='.zip':
        with zipfile.ZipFile(path) as z:
            for item in z.infolist():
                target=destination(root,item.filename)
                mode=item.external_attr>>16
                if mode&0o170000==0o120000:
                    raise ValueError('Unexpected ZIP link')
                if item.is_dir():
                    target.mkdir(parents=True,exist_ok=True)
                else:
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with z.open(item) as source,target.open('xb') as out:
                        shutil.copyfileobj(source,out)
                    target.chmod(mode&0o777 or 0o644)
    else:
        links=[]
        with tarfile.open(path) as tar:
            for item in tar:
                target=destination(root,item.name)
                if item.isdir():
                    target.mkdir(parents=True,exist_ok=True)
                elif item.isfile():
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with tar.extractfile(item) as source,target.open('xb') as out:
                        shutil.copyfileobj(source,out)
                    target.chmod(item.mode&0o777)
                elif item.issym() or item.islnk():
                    link=(target.parent/item.linkname) if item.issym() else root/item.linkname
                    if not link.resolve().is_relative_to(root.resolve()):
                        raise ValueError('Archive link leaves the tool directory')
                    links.append((item,target,link))
                else:
                    raise ValueError('Unsupported archive entry')
            for item,target,link in links:
                target.parent.mkdir(parents=True,exist_ok=True)
                if item.issym():
                    target.symlink_to(item.linkname)
                else:
                    os.link(link,target)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--verify-tools-only',action='store_true')
    p.add_argument('--publisher',type=pathlib.Path)
    args,forward=p.parse_known_args()
    if not args.verify_tools_only:
        assert not os.getenv('GITHUB_ACTIONS') and not os.getenv('CI'),'Publishing is an operator operation, not public CI'
        assert args.publisher and args.publisher.is_file(),'Provide the exact reviewed publisher script'
        assert hashlib.sha256(args.publisher.read_bytes()).hexdigest()==PUBLISHER_SHA,'Publisher source differs from reviewed Android 1.1.0'
        assert shutil.which('gh') and shutil.which('git'),'Existing authenticated gh/git required; no system packages will be installed'
    with tempfile.TemporaryDirectory(prefix='vps-public-apk-tools-') as temp:
        root=pathlib.Path(temp)
        assert shutil.disk_usage(root).free>=1200*1024*1024,'Need 1.2 GiB temporary free space'
        for name,url,expected in TOOLS:
            file=root/name;digest=hashlib.sha256();total=0
            with urllib.request.urlopen(url,timeout=60) as source,file.open('xb') as out:
                while True:
                    data=source.read(1024*1024)
                    if not data:break
                    total+=len(data)
                    assert total<=512*1024*1024,'Tool archive exceeds size bound'
                    digest.update(data);out.write(data)
            assert digest.hexdigest()==expected,'Official tool archive checksum mismatch'
            unpack(file,root/name.split('.')[0])
        java=list(root.glob('jdk/**/bin/java'));aapt=list(root.glob('buildtools/**/aapt2'))
        assert len(java)==len(aapt)==1,'Unexpected tool layout'
        env=dict(os.environ,JAVA_HOME=str(java[0].parent.parent),ANDROID_BUILD_TOOLS=str(aapt[0].parent),JAVA_TOOL_OPTIONS='-Xms16m -Xmx128m -XX:ActiveProcessorCount=1')
        env['PATH']=str(java[0].parent)+os.pathsep+env.get('PATH','')
        for cmd in ([str(java[0]),'-version'],[str(aapt[0]),'version'],[str(java[0]),'-jar',str(aapt[0].parent/'lib/apksigner.jar'),'version']):
            subprocess.run(cmd,env=env,check=True)
        if args.verify_tools_only:
            print('PASS: temporary Linux verification tools execute; no key, signing, publishing or host installation')
        else:
            subprocess.run(['python3',str(args.publisher.resolve()),*forward],env=env,check=True)
    print('Temporary tool directory removed')
if __name__=='__main__':main()
