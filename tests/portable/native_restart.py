"""Exercise real launcher/helper executables against isolated release fixtures.

Run on Windows with Python and Go installed as development tools. The launched
app receives a PATH containing only Windows system directories (no Python).
The production updater code is copied unchanged into a temporary Go module;
a test-only transport supplies release bytes without publishing a release.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ADDRESS = 'http://127.0.0.1:5190'
PLATFORM = 'windows-x64' if os.name == 'nt' else 'linux-x64'
BINARY = 'LaserForge-Portable.exe' if os.name == 'nt' else 'LaserForge-Portable'
BASE = 'https://github.com/gnomecatstudios/laserforge-native/releases'

TRANSPORT = r'''package main
import ("bytes"; "fmt"; "io"; "net/http"; "os"; "path/filepath"; "strings")
type fixtureTransport struct{}
func (fixtureTransport) RoundTrip(r *http.Request) (*http.Response,error) {
 name:="package.zip"
 switch {
 case strings.HasSuffix(r.URL.Path,"/releases/latest"): name="release.json"
 case strings.HasSuffix(r.URL.Path,"SHA256SUMS.txt"): name="SHA256SUMS.txt"
 }
 data,err:=os.ReadFile(filepath.Join(os.Getenv("LASERFORGE_TEST_FIXTURES"),name)); if err!=nil{return nil,err}
 return &http.Response{StatusCode:200,Header:make(http.Header),Body:io.NopCloser(bytes.NewReader(data))},nil
}
func init(){
 http.DefaultTransport=fixtureTransport{}
 executable,_:=os.Executable()
 log,err:=os.OpenFile(filepath.Join(os.Getenv("LASERFORGE_TEST_FIXTURES"),"processes.log"),os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600)
 if err==nil {fmt.Fprintf(log,"%d|%s|%s\n",os.Getpid(),executable,strings.Join(os.Args[1:]," ")); log.Close()}
 // Avoid launching a desktop browser on unattended runners. The real native
 // restart, executable replacement and local HTTP server are still exercised.
 os.Args=append(os.Args,"--no-browser")
}
'''


def wait_for(check, label, seconds=60):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, ValueError, http.client.HTTPException) as error:
            last = error
        time.sleep(0.2)
    raise AssertionError(f'Timed out: {label}; last error: {last}')


def launcher_running(process, pid):
    # Windows starts the launcher through Start-LaserForge.cmd, which hands it
    # off with `start` and exits, so look the launcher up by its own process ID.
    if os.name != 'nt':
        return process.poll() is None
    found = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH', '/FO', 'CSV'],
                           capture_output=True, text=True).stdout
    return f'"{pid}"' in found


def read_url(path):
    with urllib.request.urlopen(ADDRESS + path, timeout=2) as response:
        return response.read()


def status():
    return json.loads(read_url('/api/portable-update'))


def action(name, token):
    request = urllib.request.Request(ADDRESS + '/api/portable-update?action=' + name,
        method='POST', headers={'Origin': ADDRESS, 'X-LaserForge-Update': token})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 202


def build(work, version):
    module = work / ('source-' + version)
    module.mkdir()
    # Every launcher source file (the app window, phone capture and its page
    # included), without the Go unit tests.
    launcher = ROOT / 'portable/launcher'
    for path in [*launcher.glob('*.go'), *launcher.glob('*.html'), launcher / 'go.mod']:
        if not path.name.endswith('_test.go'):
            shutil.copy2(path, module / path.name)
    (module / 'fixture_transport.go').write_text(TRANSPORT)
    (module / 'dist').mkdir()
    (module / 'dist/index.html').write_text('native-restart-test-' + version)
    (module / 'dist/portable-platform.json').write_text(json.dumps({'platform': PLATFORM, 'version': version}))
    output = work / ('build-' + version) / BINARY
    output.parent.mkdir()
    subprocess.run(['go', 'build', '-buildvcs=false', '-o', str(output), '.'], cwd=module, check=True)
    return output


def main():
    # Refuse to interfere with an existing user's launcher.
    import socket
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 5190))
    with tempfile.TemporaryDirectory(prefix='Laser Forge restart test ') as temporary:
        work = Path(temporary)
        fixture = work / 'fixtures'
        fixture.mkdir()
        install = work / 'installation with spaces'
        install.mkdir()
        old_binary = build(work, '1.0.0')
        new_binary = build(work, '1.2.3')
        shutil.copy2(old_binary, install / BINARY)
        (install / 'release.json').write_text(json.dumps({'platform': PLATFORM, 'version': '1.0.0'}))
        (install / 'project.olaser').write_text('preserve this project')
        if os.name == 'nt':
            shutil.copy2(ROOT / 'portable/Start-LaserForge.cmd', install / 'Start-LaserForge.cmd')
        package = fixture / 'package.zip'
        with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.write(new_binary, 'LaserForge-Portable/' + BINARY)
            archive.writestr('LaserForge-Portable/release.json', json.dumps({'platform': PLATFORM, 'version': '1.2.3'}))
            archive.writestr('LaserForge-Portable/VERSION.txt', 'restart-tested-1.2.3')
        valid_bytes = package.read_bytes()
        name = f'LaserForge-Portable-{PLATFORM}-v1.2.3.zip'
        sums = f'{hashlib.sha256(valid_bytes).hexdigest()}  {name}\n'
        (fixture / 'SHA256SUMS.txt').write_text(sums)
        def asset(name, size):
            return {'name': name, 'size': size, 'state': 'uploaded', 'browser_download_url': BASE + '/download/v1.2.3/' + name}
        (fixture / 'release.json').write_text(json.dumps({'tag_name': 'v1.2.3', 'html_url': BASE + '/tag/v1.2.3',
            'draft': False, 'prerelease': False, 'assets': [asset(name, len(valid_bytes)), asset('SHA256SUMS.txt', len(sums))]}))
        environment = {**os.environ, 'LASERFORGE_TEST_FIXTURES': str(fixture)}
        if os.name == 'nt':
            environment['PATH'] = os.environ['SystemRoot'] + r'\System32'
            # The hosted runner installs py.exe in the Windows root. Keep only
            # System32 so neither Python nor its launcher is discoverable.
            assert shutil.which('python', path=environment['PATH']) is None
            assert shutil.which('py', path=environment['PATH']) is None
            command = [os.environ['COMSPEC'], '/c', str(install / 'Start-LaserForge.cmd')]
        else:
            command = [str(install / BINARY), '--no-browser']
        with (work / 'launcher.log').open('w+') as log:
            process = subprocess.Popen(command, cwd=install, env=environment, stdout=log, stderr=log)
            try:
                initial = wait_for(status, 'initial native updater starts')
                assert initial['status'] == 'idle'
                token = initial['token']
                launcher = int((fixture / 'processes.log').read_text().splitlines()[0].split('|', 1)[0])
                print('PASS: native launcher starts without Python in PATH', flush=True)
                # A corrupt package must leave the running app and project intact.
                package.write_bytes(bytes([valid_bytes[0] ^ 1]) + valid_bytes[1:])
                action('download', token)
                failed = wait_for(lambda: (value if (value := status())['status'] == 'error' else None), 'corrupt update rejected')
                assert 'checksum' in failed['error']
                assert (install / BINARY).read_bytes() == old_binary.read_bytes()
                assert launcher_running(process, launcher)
                assert read_url('/') == b'native-restart-test-1.0.0'
                print('PASS: corrupt update rejected; old app still running', flush=True)
                package.write_bytes(valid_bytes)
                action('download', token)
                ready = wait_for(lambda: (value if (value := status())['status'] == 'ready' else None), 'verified update staged')
                assert ready['version'] == '1.2.3'
                assert (install / BINARY).read_bytes() == old_binary.read_bytes()
                print('PASS: verified update staged without replacing running executable', flush=True)
                action('install', token)
                wait_for(lambda: read_url('/') == b'native-restart-test-1.2.3', 'updated native server restarts', seconds=90)
                wait_for(lambda: not launcher_running(process, launcher), 'old launcher exits', seconds=15)
                process.wait(timeout=15)
                assert process.returncode == 0
                restarted = status()
                assert restarted['status'] == 'idle'
                assert restarted['token'] != token
                assert (install / BINARY).read_bytes() == new_binary.read_bytes()
                assert json.loads((install / 'release.json').read_text())['version'] == '1.2.3'
                assert (install / 'project.olaser').read_text() == 'preserve this project'
                assert not (install / '.native-update.zip').exists()
                events = (fixture / 'processes.log').read_text().splitlines()
                assert any('--install-update' in line for line in events)
                assert len({line.split('|', 1)[0] for line in events}) >= 3
                print('PASS: old launcher exits, separate helper installs, new launcher serves new version', flush=True)
                print('PASS: new updater active, project preserved, staged archive removed', flush=True)
                print('\n'.join(events), flush=True)
            finally:
                # Stop every process created by this isolated test, including the
                # restarted executable, before TemporaryDirectory removes files.
                events_file = fixture / 'processes.log'
                if events_file.exists():
                    for line in reversed(events_file.read_text().splitlines()):
                        pid = int(line.split('|', 1)[0])
                        if os.name == 'nt':
                            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        else:
                            try:
                                os.kill(pid, 15)
                            except ProcessLookupError:
                                pass
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=10)
                time.sleep(1)
                log.seek(0)
                print(log.read(), flush=True)


if __name__ == '__main__':
    main()
