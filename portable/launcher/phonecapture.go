package main

// Phone capture: the desktop app shows a QR code; a phone on the same network
// scans it, opens a small camera page served here, and its photos are queued
// for the desktop tab to import.
//
// The main app stays on 127.0.0.1. Only while capture is active does a second,
// minimal server listen on the local network, and it answers nothing but the
// camera page and uploads carrying the current random token.

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed phone.html
var phonePage []byte

const (
	capturePort     = 5191
	maxCaptureBytes = 25 << 20
	maxCaptureQueue = 12
	// Capture stops by itself if the desktop tab stops asking for photos.
	captureIdle = 10 * time.Minute
)

type capturedPhoto struct {
	name string
	mime string
	data []byte
}

type phoneCapture struct {
	sync.Mutex
	token     string
	lastPoll  time.Time
	queue     []capturedPhoto
	received  int
	server    *http.Server
	listen    func(network, address string) (net.Listener, error)
	addresses func() []string
}

func newPhoneCapture() *phoneCapture {
	return &phoneCapture{listen: net.Listen, addresses: lanAddresses}
}

// lanAddresses lists IPv4 addresses a phone on the same network might reach, likeliest first.
func lanAddresses() []string {
	var found []string
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipnet.IP.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			found = append(found, ip.String())
		}
	}
	// Home networks first.
	rank := func(ip string) int {
		switch {
		case strings.HasPrefix(ip, "192.168."):
			return 0
		case strings.HasPrefix(ip, "10."):
			return 1
		case net.ParseIP(ip).IsPrivate():
			return 2 // 172.16-31.x: often VMs and containers
		}
		return 3 // public or VPN (for example Tailscale's 100.x)
	}
	sort.SliceStable(found, func(i, j int) bool { return rank(found[i]) < rank(found[j]) })
	return found
}

func randomToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

// localRequest rejects requests that did not come from the app tab on this computer:
// other hosts (DNS rebinding) and cross-site pages (the custom header forces a preflight).
func localRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	if host != "127.0.0.1" && host != "localhost" {
		return false
	}
	return r.Header.Get("X-LaserForge-Capture") == "1"
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func (c *phoneCapture) expired(now time.Time) bool {
	return c.token == "" || now.Sub(c.lastPoll) > captureIdle
}

func (c *phoneCapture) validToken(candidate string) bool {
	c.Lock()
	defer c.Unlock()
	if c.expired(time.Now()) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(c.token)) == 1
}

// handle serves the desktop-only API on the loopback server.
func (c *phoneCapture) handle(w http.ResponseWriter, r *http.Request) {
	if !localRequest(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	switch strings.TrimPrefix(r.URL.Path, "/api/phone-capture/") {
	case "start":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c.start(w)
	case "stop":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c.stop()
		w.WriteHeader(http.StatusNoContent)
	case "take":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		c.take(w)
	default:
		http.NotFound(w, r)
	}
}

func (c *phoneCapture) start(w http.ResponseWriter) {
	c.Lock()
	defer c.Unlock()
	if c.server == nil {
		listener, err := c.listen("tcp4", fmt.Sprintf("0.0.0.0:%d", capturePort))
		if err != nil {
			http.Error(w, fmt.Sprintf("cannot listen on port %d: %v", capturePort, err), http.StatusServiceUnavailable)
			return
		}
		server := &http.Server{
			Handler:           c.phoneHandler(),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       2 * time.Minute,
		}
		c.server = server
		go func() { _ = server.Serve(listener) }()
		go c.watch(server)
	}
	if c.expired(time.Now()) {
		token, err := randomToken()
		if err != nil {
			http.Error(w, "cannot create capture token", http.StatusInternalServerError)
			return
		}
		c.token = token
		c.queue = nil
		c.received = 0
	}
	c.lastPoll = time.Now()
	urls := []string{}
	for _, ip := range c.addresses() {
		urls = append(urls, fmt.Sprintf("http://%s:%d/capture/%s", ip, capturePort, c.token))
	}
	writeJSON(w, map[string]any{"urls": urls, "port": capturePort})
}

// stop forgets the token and closes the network listener.
func (c *phoneCapture) stop() {
	c.Lock()
	defer c.Unlock()
	c.token = ""
	c.queue = nil
	if c.server != nil {
		_ = c.server.Close()
		c.server = nil
	}
}

// watch closes the network listener once the desktop tab stops polling.
func (c *phoneCapture) watch(server *http.Server) {
	for {
		time.Sleep(30 * time.Second)
		c.Lock()
		if c.server != server {
			c.Unlock()
			return
		}
		idle := c.expired(time.Now())
		c.Unlock()
		if idle {
			c.stop()
			return
		}
	}
}

// take hands the oldest queued photo to the desktop tab, or 204 when none is waiting.
func (c *phoneCapture) take(w http.ResponseWriter) {
	c.Lock()
	if c.token == "" {
		c.Unlock()
		http.Error(w, "capture is not running", http.StatusConflict)
		return
	}
	c.lastPoll = time.Now()
	if len(c.queue) == 0 {
		c.Unlock()
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	photo := c.queue[0]
	c.queue = c.queue[1:]
	c.Unlock()
	w.Header().Set("Content-Type", photo.mime)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Capture-Name", url.PathEscape(photo.name))
	_, _ = w.Write(photo.data)
}

// sniffPhoto accepts only formats the app decodes everywhere.
func sniffPhoto(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case len(data) >= 12 && bytes.Equal(data[0:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp"
	}
	return ""
}

func cleanPhotoName(raw string, mime string) string {
	name, err := url.PathUnescape(raw)
	if err != nil {
		name = ""
	}
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return -1
		}
		return r
	}, name)
	if len(name) > 80 {
		name = name[len(name)-80:]
	}
	if name == "" || name == "." {
		name = "phone-photo-" + time.Now().Format("150405")
	}
	ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
	if !strings.HasSuffix(strings.ToLower(name), ext) && !(ext == ".jpg" && strings.HasSuffix(strings.ToLower(name), ".jpeg")) {
		name = strings.TrimSuffix(name, path.Ext(name)) + ext
	}
	return name
}

// phoneHandler serves the network-facing side: the camera page and uploads, nothing else.
func (c *phoneCapture) phoneHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 || parts[0] != "capture" || !c.validToken(parts[1]) {
			http.Error(w, "This scan link has expired. Open “Scan with phone” in Laser Forge and scan the new code.", http.StatusNotFound)
			return
		}
		switch {
		case len(parts) == 2 && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
			_, _ = w.Write(phonePage)
		case len(parts) == 3 && parts[2] == "upload" && r.Method == http.MethodPost:
			c.upload(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func (c *phoneCapture) upload(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCaptureBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "The photo is too large (25 MB limit).", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Upload interrupted. Try again.", http.StatusBadRequest)
		return
	}
	mime := sniffPhoto(data)
	if mime == "" {
		http.Error(w, "Send a JPEG, PNG or WebP photo.", http.StatusUnsupportedMediaType)
		return
	}
	name := cleanPhotoName(r.Header.Get("X-File-Name"), mime)
	c.Lock()
	defer c.Unlock()
	if len(c.queue) >= maxCaptureQueue {
		http.Error(w, "Laser Forge is still importing earlier photos. Wait a moment and try again.", http.StatusTooManyRequests)
		return
	}
	c.queue = append(c.queue, capturedPhoto{name: name, mime: mime, data: data})
	c.received++
	writeJSON(w, map[string]any{"ok": true, "name": name, "count": c.received})
}

// Used by tests to read the token without racing the server.
func (c *phoneCapture) currentToken() string {
	c.Lock()
	defer c.Unlock()
	return c.token
}
