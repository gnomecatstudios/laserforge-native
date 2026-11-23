package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Updates come only from the native app's own releases, never from the browser-tab
// Laser Forge releases, which would replace the app-window launcher.
const releaseRepo = "gnomecatstudios/laserforge-native"
const releaseBase = "https://github.com/" + releaseRepo + "/releases"
const releaseAPI = "https://api.github.com/repos/" + releaseRepo + "/releases/latest"
const maxUpdate = 128 << 20

type installation struct {
	Platform string `json:"platform"`
	Version  string `json:"version"`
}
type updateState struct {
	sync.Mutex
	Status    string `json:"status"`
	Version   string `json:"version,omitempty"`
	Error     string `json:"error,omitempty"`
	Token     string `json:"token"`
	root      string
	installed installation
}

func stableVersion(value string) ([3]int, error) {
	var result [3]int
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(value) {
		return result, errors.New("invalid stable version")
	}
	for i, part := range strings.Split(value, ".") {
		n, err := strconv.Atoi(part)
		if err != nil {
			return result, err
		}
		result[i] = n
	}
	return result, nil
}
func newer(candidate, current string) bool {
	a, err := stableVersion(candidate)
	if err != nil {
		return false
	}
	b, err := stableVersion(current)
	if err != nil {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
func nativePlatform() string {
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		return "windows-x64"
	}
	if runtime.GOOS == "linux" {
		switch runtime.GOARCH {
		case "amd64":
			return "linux-x64"
		case "arm64":
			return "raspberry-pi-arm64"
		case "arm":
			return "raspberry-pi-arm32"
		}
	}
	return ""
}
func readInstallation(root string) (installation, error) {
	var value installation
	data, err := os.ReadFile(filepath.Join(root, "release.json"))
	if err != nil {
		return value, err
	}
	if err = json.Unmarshal(data, &value); err != nil {
		return value, err
	}
	if _, err = stableVersion(value.Version); err != nil {
		return value, err
	}
	if value.Platform != nativePlatform() || value.Platform == "" {
		return value, errors.New("package platform mismatch")
	}
	return value, nil
}
func updateFetch(url string, limit int64) ([]byte, error) {
	client := &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || len(via) > 10 {
			return errors.New("invalid download redirect")
		}
		return nil
	}}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "LaserForge-Native-Updater")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update download failed (%d)", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("update exceeds size limit")
	}
	return data, nil
}
func verifiedDownload(current installation, cached ...[]byte) ([]byte, string, error) {
	data, err := updateFetch(releaseAPI, 1<<20)
	if err != nil {
		return nil, "", err
	}
	var release struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name  string `json:"name"`
			URL   string `json:"browser_download_url"`
			Size  int64  `json:"size"`
			State string `json:"state"`
		} `json:"assets"`
	}
	if err = json.Unmarshal(data, &release); err != nil {
		return nil, "", err
	}
	version := strings.TrimPrefix(release.Tag, "v")
	if release.Draft || release.Prerelease || release.Tag != "v"+version || release.URL != releaseBase+"/tag/"+release.Tag {
		return nil, "", errors.New("invalid release")
	}
	if _, err = stableVersion(version); err != nil {
		return nil, "", err
	}
	if !newer(version, current.Version) {
		return nil, "", nil
	}
	short := map[string]string{"raspberry-pi-arm64": "RPi-ARM64", "raspberry-pi-arm32": "RPi-ARM32"}[current.Platform]
	if short == "" {
		short = current.Platform
	}
	name := "LaserForge-Portable-" + short + "-v" + version + ".zip"
	asset := func(name string) (string, int64, error) {
		expected := releaseBase + "/download/" + release.Tag + "/" + name
		count := 0
		var size int64
		for _, a := range release.Assets {
			if a.Name == name && a.URL == expected && a.State == "uploaded" && a.Size > 0 && a.Size <= maxUpdate {
				count++
				size = a.Size
			}
		}
		if count != 1 {
			return "", 0, fmt.Errorf("missing or invalid asset: %s", name)
		}
		return expected, size, nil
	}
	url, size, err := asset(name)
	if err != nil {
		return nil, "", err
	}
	sumsURL, _, err := asset("SHA256SUMS.txt")
	if err != nil {
		return nil, "", err
	}
	sums, err := updateFetch(sumsURL, 64<<10)
	if err != nil {
		return nil, "", err
	}
	var expected string
	count := 0
	for _, line := range strings.Split(string(sums), "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == name {
			expected = parts[0]
			count++
		}
	}
	hash, err := hex.DecodeString(expected)
	if err != nil || len(hash) != 32 || count != 1 {
		return nil, "", errors.New("missing or invalid checksum")
	}
	var payload []byte
	if len(cached) > 0 {
		payload = cached[0]
	} else {
		payload, err = updateFetch(url, maxUpdate)
		if err != nil {
			return nil, "", err
		}
	}
	actual := sha256.Sum256(payload)
	if int64(len(payload)) != size || !bytes.Equal(actual[:], hash) {
		return nil, "", errors.New("update checksum/size mismatch")
	}
	return payload, version, nil
}

// Validate the entire archive before writing anything into the installation.
func extractUpdate(payload []byte, destination string, expected installation) error {
	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return err
	}
	if len(archive.File) > 1000 {
		return errors.New("too many update files")
	}
	allowed := map[string]bool{"LaserForge-Portable": true, "LaserForge-Portable.exe": true, "icon.png": true, "LaserForge.ico": true, "README.txt": true, "LICENSE-LaserForge.txt": true, "VERSION.txt": true, "release.json": true, "setup.py": true, "update.py": true, "Start-LaserForge.cmd": true}
	seen := map[string]bool{}
	var total uint64
	for _, file := range archive.File {
		name := strings.TrimSuffix(file.Name, "/")
		parts := strings.Split(name, "/")
		key := strings.ToLower(name)
		if file.UncompressedSize64 > maxUpdate {
			return errors.New("update file too large")
		}
		total += file.UncompressedSize64
		if total > maxUpdate || seen[key] || path.Clean(name) != name || strings.ContainsAny(name, "\\:") || parts[0] != "LaserForge-Portable" || file.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe update archive")
		}
		seen[key] = true
		if file.FileInfo().IsDir() {
			if len(parts) > 2 || len(parts) == 2 && parts[1] != "Fonts" {
				return errors.New("unexpected directory")
			}
			continue
		}
		if !(len(parts) == 2 && allowed[parts[1]] || len(parts) == 3 && parts[1] == "Fonts") {
			return errors.New("unexpected update file")
		}
	}
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(strings.TrimPrefix(file.Name, "LaserForge-Portable/")))
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			source.Close()
			return err
		}
		_, copyErr := io.Copy(output, io.LimitReader(source, maxUpdate+1))
		closeErr := output.Close()
		source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	installed, err := readInstallation(destination)
	if err != nil {
		return err
	}
	if installed != expected {
		return errors.New("package version/platform mismatch")
	}
	binaryName := "LaserForge-Portable"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	header, err := os.ReadFile(filepath.Join(destination, binaryName))
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		if len(header) < 64 || string(header[:2]) != "MZ" {
			return errors.New("invalid executable")
		}
		offset := uint64(binary.LittleEndian.Uint32(header[60:64]))
		if offset+6 > uint64(len(header)) || string(header[offset:offset+4]) != "PE\x00\x00" || binary.LittleEndian.Uint16(header[offset+4:offset+6]) != 0x8664 {
			return errors.New("expected Windows x64 executable")
		}
	} else {
		if len(header) < 20 || string(header[:4]) != "\x7fELF" || header[5] != 1 {
			return errors.New("invalid executable")
		}
		expected := map[string]struct {
			class   byte
			machine uint16
		}{"linux-x64": {2, 62}, "raspberry-pi-arm64": {2, 183}, "raspberry-pi-arm32": {1, 40}}[expected.Platform]
		if header[4] != expected.class || binary.LittleEndian.Uint16(header[18:20]) != expected.machine {
			return errors.New("executable architecture mismatch")
		}
	}
	return os.Chmod(filepath.Join(destination, binaryName), 0755)
}

func portableUpdates(files fs.FS) *updateState {
	executable, err := os.Executable()
	if err != nil {
		return nil
	}
	root := filepath.Dir(executable)
	current, err := readInstallation(root)
	if err != nil {
		return nil
	}
	embedded, err := fs.ReadFile(files, "portable-platform.json")
	if err != nil {
		return nil
	}
	var built installation
	if json.Unmarshal(embedded, &built) != nil || built != current {
		return nil
	}
	if strings.HasPrefix(root, "/usr/") || strings.HasPrefix(root, "/opt/") {
		return nil
	}
	token := make([]byte, 32)
	if _, err = rand.Read(token); err != nil {
		return nil
	}
	return &updateState{Status: "idle", Token: hex.EncodeToString(token), root: root, installed: current}
}
func (u *updateState) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Host != "127.0.0.1:5190" {
		http.Error(w, "invalid host", 403)
		return
	}
	if r.Method == "GET" {
		u.Lock()
		defer u.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u)
		return
	}
	if r.Method != "POST" {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", 405)
		return
	}
	if r.Header.Get("Origin") != "http://127.0.0.1:5190" || r.Header.Get("X-LaserForge-Update") != u.Token {
		http.Error(w, "invalid update request", 403)
		return
	}
	u.Lock()
	defer u.Unlock()
	switch r.URL.Query().Get("action") {
	case "download":
		if u.Status == "downloading" || u.Status == "restarting" {
			http.Error(w, "update already running", 409)
			return
		}
		u.Status = "downloading"
		u.Error = ""
		go func() {
			payload, version, err := verifiedDownload(u.installed)
			if err == nil && payload != nil {
				var work string
				work, err = os.MkdirTemp(u.root, ".native-validate-")
				if err == nil {
					err = extractUpdate(payload, work, installation{u.installed.Platform, version})
					os.RemoveAll(work)
				}
				if err == nil {
					err = os.WriteFile(filepath.Join(u.root, ".native-update.zip.tmp"), payload, 0600)
				}
				if err == nil {
					err = os.Rename(filepath.Join(u.root, ".native-update.zip.tmp"), filepath.Join(u.root, ".native-update.zip"))
				}
			}
			u.Lock()
			defer u.Unlock()
			u.Version = version
			u.Status = "current"
			if err != nil {
				u.Status = "error"
				u.Error = err.Error()
			} else if payload != nil {
				u.Status = "ready"
			}
		}()
	case "install":
		if u.Status != "ready" {
			http.Error(w, "download the update first", 409)
			return
		}
		if err := startUpdateHelper(u.root); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		u.Status = "restarting"
		go func() { time.Sleep(time.Second); os.Exit(0) }()
	default:
		http.Error(w, "unknown update action", 400)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
func startUpdateHelper(root string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(executable)
	if err != nil {
		return err
	}
	folder, err := os.MkdirTemp("", "laserforge-updater-")
	if err != nil {
		return err
	}
	helper := filepath.Join(folder, filepath.Base(executable))
	if err = os.WriteFile(helper, data, 0700); err != nil {
		os.RemoveAll(folder)
		return err
	}
	cmd := exec.Command(helper, "--install-update", root)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		os.RemoveAll(folder)
		return err
	}
	return cmd.Process.Release()
}
func applyNativeUpdate(root string) error {
	// Wait for the serving launcher to release its port and executable.
	var reservation net.Listener
	for i := 0; i < 120; i++ {
		listener, err := net.Listen("tcp4", "127.0.0.1:5190")
		if err == nil {
			reservation = listener
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if reservation == nil {
		return errors.New("close Laser Forge and its launcher before updating")
	}
	defer reservation.Close()
	installed, err := readInstallation(root)
	if err != nil {
		return err
	}
	// Recheck the official release and checksum before trusting cached bytes.
	pending, err := os.Open(filepath.Join(root, ".native-update.zip"))
	if err != nil {
		return err
	}
	cached, err := io.ReadAll(io.LimitReader(pending, maxUpdate+1))
	pending.Close()
	if err != nil {
		return err
	}
	if len(cached) > maxUpdate {
		return errors.New("cached update exceeds size limit")
	}
	payload, version, err := verifiedDownload(installed, cached)
	if err != nil {
		return err
	}
	if payload == nil {
		return errors.New("no newer release available")
	}
	work, err := os.MkdirTemp(root, ".native-install-")
	if err != nil {
		return err
	}
	keepBackup := false
	defer func() {
		if !keepBackup {
			os.RemoveAll(work)
		}
	}()
	staged := filepath.Join(work, "new")
	if err = os.Mkdir(staged, 0700); err != nil {
		return err
	}
	if err = extractUpdate(payload, staged, installation{installed.Platform, version}); err != nil {
		return err
	}
	type replacement struct {
		target, backup string
		existed        bool
	}
	var changed []replacement
	err = filepath.WalkDir(staged, func(source string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, _ := filepath.Rel(staged, source)
		target := filepath.Join(root, relative)
		for _, check := range []string{target, filepath.Dir(target)} {
			if info, e := os.Lstat(check); e == nil && info.Mode()&os.ModeSymlink != 0 {
				return errors.New("refusing linked installation files")
			}
		}
		if e := os.MkdirAll(filepath.Dir(target), 0755); e != nil {
			return e
		}
		backup := filepath.Join(work, "backup", relative)
		existed := false
		if _, e := os.Stat(target); e == nil {
			existed = true
			if e = os.MkdirAll(filepath.Dir(backup), 0700); e != nil {
				return e
			}
			var moveErr error
			for i := 0; i < 40; i++ {
				moveErr = os.Rename(target, backup)
				if moveErr == nil {
					break
				}
				time.Sleep(250 * time.Millisecond)
			}
			if moveErr != nil {
				return moveErr
			}
		} else if !os.IsNotExist(e) {
			return e
		}
		changed = append(changed, replacement{target, backup, existed})
		return os.Rename(source, target)
	})
	if err != nil {
		for i := len(changed) - 1; i >= 0; i-- {
			item := changed[i]
			os.Remove(item.target)
			if item.existed {
				if e := os.Rename(item.backup, item.target); e != nil {
					keepBackup = true
					return fmt.Errorf("update failed: %v; rollback failed: %v; backup: %s", err, e, work)
				}
			}
		}
		return err
	}
	os.Remove(filepath.Join(root, ".native-update.zip"))
	binary := filepath.Join(root, "LaserForge-Portable")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	reservation.Close()
	cmd := exec.Command(binary)
	cmd.Dir = root
	// The open app window reloads itself; the new launcher only opens one if it was closed.
	cmd.Env = append(os.Environ(), afterUpdateEnv+"=1")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}
