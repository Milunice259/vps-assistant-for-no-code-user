import importlib.util, os, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('publisher', ROOT/'android/app/publish-release.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
SOURCE='a'*40
TAG='android-v1.1.1'
def error(status):return subprocess.CalledProcessError(1,['gh'],stderr=f'HTTP {status}')
class ReleaseTests(unittest.TestCase):
    def test_draft_without_tag_creates_then_reads_exact_ref(self):
        with patch.object(publisher,'gh_api',side_effect=[error(404),{'ref':'created'},{'object':{'type':'commit','sha':SOURCE}}]) as api:
            publisher.verify_release_tag(TAG,SOURCE)
            self.assertEqual(api.call_count,3)
            self.assertEqual(api.call_args_list[1].args,(f'repos/{publisher.REPO}/git/refs','POST',{'ref':f'refs/tags/{TAG}','sha':SOURCE}))
    def test_existing_correct_tag_never_written(self):
        with patch.object(publisher,'gh_api',return_value={'object':{'type':'commit','sha':SOURCE}}) as api:
            publisher.verify_release_tag(TAG,SOURCE);self.assertEqual(api.call_count,1)
    def test_existing_other_source_rejected_without_write(self):
        with patch.object(publisher,'gh_api',return_value={'object':{'type':'commit','sha':'b'*40}}) as api:
            with self.assertRaises(AssertionError):publisher.verify_release_tag(TAG,SOURCE)
            self.assertEqual(api.call_count,1)
    def test_concurrent_tag_creation_verified(self):
        with patch.object(publisher,'gh_api',side_effect=[error(404),error(422),{'object':{'type':'commit','sha':SOURCE}}]):publisher.verify_release_tag(TAG,SOURCE)
    def test_authorization_error_is_not_missing_tag(self):
        with patch.object(publisher,'gh_api',side_effect=error(403)) as api:
            with self.assertRaises(subprocess.CalledProcessError):publisher.verify_release_tag(TAG,SOURCE)
            self.assertEqual(api.call_count,1)
    def test_annotated_tag_resolves_to_exact_commit(self):
        with patch.object(publisher,'gh_api',side_effect=[{'object':{'type':'tag','sha':'c'*40}},{'object':{'type':'commit','sha':SOURCE}}]) as api:
            publisher.verify_release_tag(TAG,SOURCE);self.assertEqual(api.call_count,2)
    def test_publish_flag_reaches_guard_not_publisher_option_abbreviation(self):
        wrapper=ROOT/'android/owner-signer/verify-publish-portable.py'
        env=dict(os.environ,CI='true')
        p=subprocess.run([sys.executable,str(wrapper),'--publisher',str(ROOT/'android/app/publish-release.py'),'--publish'],env=env,text=True,capture_output=True)
        self.assertNotEqual(p.returncode,0)
        self.assertIn('Publishing is an operator operation',p.stderr)
        self.assertNotIn('expected one argument',p.stderr)
    def badging(self, first, exit_status=0):
        with tempfile.TemporaryDirectory() as temp:
            fake=pathlib.Path(temp)/'fake-aapt2'
            fake.write_text('#!/usr/bin/env python3\nimport sys\nprint('+repr(first)+')\nsys.stdout.write("long metadata"*100000)\nsys.exit('+str(exit_status)+')\n')
            fake.chmod(0o700)
            p=subprocess.run(['bash','-c','source "$1"; check_badging "$2" ignored.apk 10100 1.1.0','check',str(ROOT/'android/app/sign-release.sh'),str(fake)],text=True,capture_output=True)
            return p
    def test_full_badging_consumed_without_sigpipe(self):
        result=self.badging("package: name='com.vpscontrol.widget' versionCode='10100' versionName='1.1.0' target='35'")
        self.assertEqual(result.returncode,0,result.stderr)
    def test_wrong_package_rejected(self):
        self.assertNotEqual(self.badging("package: name='com.evil.other' versionCode='10100' versionName='1.1.0'").returncode,0)
    def test_aapt_failure_preserved(self):
        self.assertEqual(self.badging("package: name='com.vpscontrol.widget' versionCode='10100' versionName='1.1.0'",7).returncode,7)
if __name__=='__main__':unittest.main()
