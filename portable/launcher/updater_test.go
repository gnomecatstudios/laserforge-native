package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStableVersions(t *testing.T) {
	for _, value := range []string{"", "1.2", "1.2.3-beta", "v1.2.3", "1.2.3/evil"} {
		if _, err := stableVersion(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	if !newer("0.10.0", "0.9.9") || newer("1.0.0", "1.0.0") || newer("0.9.9", "0.10.0") {
		t.Fatal("incorrect version order")
	}
}
func updateArchive(t *testing.T, extra map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	metadata, _ := json.Marshal(installation{nativePlatform(), "1.2.3"})
	binaryName := "LaserForge-Portable"
	header := make([]byte, 128)
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
		copy(header, "MZ")
		binary.LittleEndian.PutUint32(header[60:], 64)
		copy(header[64:], "PE\x00\x00")
		binary.LittleEndian.PutUint16(header[68:], 0x8664)
	} else {
		copy(header, "\x7fELF")
		header[5] = 1
		switch runtime.GOARCH {
		case "amd64":
			header[4] = 2
			binary.LittleEndian.PutUint16(header[18:], 62)
		case "arm64":
			header[4] = 2
			binary.LittleEndian.PutUint16(header[18:], 183)
		case "arm":
			header[4] = 1
			binary.LittleEndian.PutUint16(header[18:], 40)
		}
	}
	entries := map[string]string{"LaserForge-Portable/release.json": string(metadata), "LaserForge-Portable/" + binaryName: string(header), "LaserForge-Portable/Fonts/test.ttf": "font"}
	for name, value := range extra {
		entries[name] = value
	}
	for name, value := range entries {
		stream, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		stream.Write([]byte(value))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func TestArchiveValidation(t *testing.T) {
	expected := installation{nativePlatform(), "1.2.3"}
	if err := extractUpdate(updateArchive(t, nil), t.TempDir(), expected); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"LaserForge-Portable/../escape", "LaserForge-Portable/evil.exe", "LaserForge-Portable/Fonts/../../escape", "LaserForge-Portable/Fonts/a:b", "Other/release.json", "LaserForge-Portable/README.txt/evil", "LaserForge-Portable/Fonts\\escape"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			if err := extractUpdate(updateArchive(t, map[string]string{name: "evil"}), root, expected); err == nil {
				t.Fatal("unsafe archive accepted")
			}
			entries, _ := os.ReadDir(root)
			if len(entries) != 0 {
				t.Fatal("wrote files before validating archive")
			}
		})
	}
	if err := extractUpdate(updateArchive(t, nil), t.TempDir(), installation{nativePlatform(), "9.9.9"}); err == nil {
		t.Fatal("wrong version accepted")
	}
	binaryName := "LaserForge-Portable"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	if err := extractUpdate(updateArchive(t, map[string]string{"LaserForge-Portable/" + binaryName: "wrong"}), t.TempDir(), expected); err == nil {
		t.Fatal("invalid executable accepted")
	}
}
func TestUpdateRequestAuthorization(t *testing.T) {
	u := &updateState{Status: "idle", Token: "secret", root: t.TempDir()}
	for _, test := range []struct {
		method, host, origin, token string
		status                      int
	}{
		{"POST", "127.0.0.1:5190", "https://evil.example", "secret", 403},
		{"POST", "127.0.0.1:5190", "http://127.0.0.1:5190", "wrong", 403},
		{"POST", "evil.example", "http://127.0.0.1:5190", "secret", 403},
		{"GET", "evil.example", "", "", 403},
		{"GET", "127.0.0.1:5190", "", "", 200},
		{"DELETE", "127.0.0.1:5190", "", "", 405},
		{"POST", "127.0.0.1:5190", "http://127.0.0.1:5190", "secret", 409},
	} {
		req := httptest.NewRequest(test.method, "http://"+test.host+"/api/portable-update?action=install", nil)
		req.Header.Set("Origin", test.origin)
		req.Header.Set("X-LaserForge-Update", test.token)
		response := httptest.NewRecorder()
		u.handle(response, req)
		if response.Code != test.status {
			t.Fatalf("%+v got %d", test, response.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(u.root, ".native-update.zip")); !os.IsNotExist(err) {
		t.Fatal("unauthorized request changed installation")
	}
}

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestReleaseChecksumVerification(t *testing.T) {
	previous := http.DefaultTransport
	defer func() { http.DefaultTransport = previous }()
	payload := updateArchive(t, nil)
	name := "LaserForge-Portable-" + map[string]string{"linux-x64": "linux-x64", "windows-x64": "windows-x64", "raspberry-pi-arm64": "RPi-ARM64", "raspberry-pi-arm32": "RPi-ARM32"}[nativePlatform()] + "-v1.2.3.zip"
	digest := sha256.Sum256(payload)
	corrupted := false
	http.DefaultTransport = fakeTransport(func(r *http.Request) (*http.Response, error) {
		var body []byte
		switch r.URL.Path {
		case "/repos/" + releaseRepo + "/releases/latest":
			asset := func(name string, size int) map[string]any {
				return map[string]any{"name": name, "size": size, "state": "uploaded", "browser_download_url": releaseBase + "/download/v1.2.3/" + name}
			}
			body, _ = json.Marshal(map[string]any{"tag_name": "v1.2.3", "html_url": releaseBase + "/tag/v1.2.3", "draft": false, "prerelease": false, "assets": []any{asset(name, len(payload)), asset("SHA256SUMS.txt", 100)}})
		default:
			if strings.HasSuffix(r.URL.Path, "SHA256SUMS.txt") {
				body = []byte(fmt.Sprintf("%x  %s\n", digest, name))
			} else {
				body = append([]byte{}, payload...)
				if corrupted {
					body[0] ^= 1
				}
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
	})
	current := installation{nativePlatform(), "1.0.0"}
	if data, version, err := verifiedDownload(current); err != nil || version != "1.2.3" || !bytes.Equal(data, payload) {
		t.Fatalf("valid download rejected: %v", err)
	}
	corrupted = true
	if _, _, err := verifiedDownload(current); err == nil {
		t.Fatal("corrupt download accepted")
	}
	tampered := append([]byte{}, payload...)
	tampered[0] ^= 1
	if _, _, err := verifiedDownload(current, tampered); err == nil {
		t.Fatal("tampered cache accepted")
	}
	if data, _, err := verifiedDownload(installation{nativePlatform(), "1.2.3"}); err != nil || data != nil {
		t.Fatal("current installation offered update")
	}
}
