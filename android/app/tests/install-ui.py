"""Click only the Android installer confirmation for a disposable signed test APK."""
import re, subprocess, sys, time, pathlib, xml.etree.ElementTree as ET
mode, folder = sys.argv[1:]
run = lambda *args: subprocess.check_output(['adb', *args], stderr=subprocess.STDOUT)
for attempt in range(20):
    time.sleep(.5)
    try:
        run('shell', 'uiautomator', 'dump', '/sdcard/install-ui.xml')
        raw = run('shell', 'cat', '/sdcard/install-ui.xml')
        tree = ET.fromstring(raw)
    except (subprocess.CalledProcessError, ET.ParseError):
        continue
    for node in tree.iter('node'):
        pkg = node.get('package', '')
        text = node.get('text', '').lower()
        wanted = {'cancel'} if mode == 'cancel' else {'install', 'update'}
        if pkg not in {'com.android.packageinstaller', 'com.google.android.packageinstaller', 'com.android.permissioncontroller'} or text not in wanted or node.get('clickable') != 'true':
            continue
        points = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
        assert len(points) == 4
        (pathlib.Path(folder) / (mode + '-system-ui.png')).write_bytes(run('exec-out', 'screencap', '-p'))
        run('shell', 'input', 'tap', str((points[0]+points[2])//2), str((points[1]+points[3])//2))
        for _ in range(30):
            time.sleep(.5)
            if mode == 'cancel' or b'versionCode=10301' in run('shell', 'dumpsys', 'package', 'com.vpscontrol.widget.qa5'):
                print('Android confirmation:', mode)
                time.sleep(1)
                sys.exit(0)
        raise SystemExit('Installer did not complete upgrade')
raise SystemExit('Installer confirmation not found')
