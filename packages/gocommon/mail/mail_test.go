package mail_test

import (
	"bufio"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net"
	nmail "net/mail"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
)

type failing struct {
	OrgName, DestinationName, DestinationURL, EndpointName, LastResult, URL string
}

func TestRenderEscapes(t *testing.T) {
	html, text, err := mail.Render("delivery_failing", failing{
		OrgName: "Acme <script>", DestinationName: "API", DestinationURL: "https://api.example.com",
		EndpointName: "Stripe", LastResult: "503 Service Unavailable", URL: "javascript:alert(1)",
	})
	require.NoError(t, err)
	assert.Contains(t, html, "Acme &lt;script&gt;")
	assert.NotContains(t, html, "<script>")
	assert.NotContains(t, html, `href="javascript:`, "unsafe URLs are neutralised in links")
	assert.Contains(t, html, `href="#ZgotmplZ"`)
	assert.Contains(t, text, "503 Service Unavailable")
	assert.NotContains(t, html, "{{")
}

func TestBuildIsMultipart(t *testing.T) {
	from, err := nmail.ParseAddress("Hookline <no-reply@hookline.test>")
	require.NoError(t, err)
	raw, err := mail.Build(from, mail.Message{
		To: []string{"a@example.com"}, Subject: "Déjà vu", Template: "usage_threshold",
		Data: map[string]string{"OrgName": "Acme", "Percent": "80", "Used": "4,000", "Limit": "5,000", "Plan": "Free", "URL": "https://hookline.test/acme/usage"},
	}, time.Now())
	require.NoError(t, err)

	msg, err := nmail.ReadMessage(strings.NewReader(string(raw)))
	require.NoError(t, err)
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	require.NoError(t, err)
	assert.Equal(t, "Déjà vu", subject)
	_, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	require.NoError(t, err)
	r := multipart.NewReader(msg.Body, params["boundary"])
	var types []string
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		types = append(types, p.Header.Get("Content-Type"))
		body, _ := io.ReadAll(p)
		assert.Contains(t, string(body), "Acme")
	}
	assert.Equal(t, []string{"text/plain; charset=utf-8", "text/html; charset=utf-8"}, types)
}

// fakeSMTP accepts one message and records the conversation. With auth set
// (e.g. "LOGIN"), it advertises those mechanisms, runs AUTH LOGIN and records
// the credentials as an "auth user/pass" first line.
func fakeSMTP(t *testing.T, auth string) (string, <-chan string) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	got := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		say := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
		say("220 fake ESMTP")
		var data strings.Builder
		inData := false
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			if inData {
				if line == ".\r\n" {
					inData = false
					say("250 queued")
					continue
				}
				data.WriteString(line)
				continue
			}
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				if auth == "" {
					say("250 fake")
				} else {
					say("250-fake")
					say("250 AUTH " + auth)
				}
			case cmd == "AUTH LOGIN":
				read := func(prompt string) string {
					say("334 " + base64.StdEncoding.EncodeToString([]byte(prompt)))
					l, _ := r.ReadString('\n')
					b, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(l))
					return string(b)
				}
				user, pass := read("Username:"), read("Password:")
				data.WriteString("auth " + user + "/" + pass + "\n")
				say("235 authenticated")
			case strings.HasPrefix(cmd, "AUTH"):
				say("504 unrecognized authentication type")
			case strings.HasPrefix(cmd, "MAIL"), strings.HasPrefix(cmd, "RCPT"):
				say("250 ok")
			case cmd == "DATA":
				inData = true
				say("354 go ahead")
			case cmd == "QUIT":
				say("221 bye")
				got <- data.String()
				return
			default:
				say("250 ok")
			}
		}
	}()
	return ln.Addr().String(), got
}

func TestSMTPAuthLogin(t *testing.T) {
	// Like Microsoft 365: LOGIN offered, PLAIN not. 127.0.0.1 counts as localhost,
	// so credentials may travel without TLS in this test only.
	addr, got := fakeSMTP(t, "LOGIN XOAUTH2")
	port := strings.TrimPrefix(addr, "127.0.0.1:")
	s, err := mail.NewSMTP("smtp://contact%40example.com:s3cret@127.0.0.1:"+port, "Hookline <contact@example.com>")
	require.NoError(t, err)
	err = s.Send(t.Context(), mail.Message{
		To: []string{"owner@example.com"}, Subject: "Deliveries are failing", Template: "delivery_failing",
		Data: failing{OrgName: "Acme", DestinationName: "API", DestinationURL: "https://api.example.com", EndpointName: "Stripe", LastResult: "timeout", URL: "https://hookline.test/acme/deliveries"},
	})
	require.NoError(t, err)
	select {
	case body := <-got:
		assert.True(t, strings.HasPrefix(body, "auth contact@example.com/s3cret\n"), body[:min(len(body), 80)])
	case <-time.After(5 * time.Second):
		t.Fatal("no message")
	}
}

func TestSMTPSend(t *testing.T) {
	addr, got := fakeSMTP(t, "")
	s, err := mail.NewSMTP("smtp://"+addr, "Hookline <no-reply@hookline.test>")
	require.NoError(t, err)
	err = s.Send(t.Context(), mail.Message{
		To: []string{"owner@example.com"}, Subject: "Deliveries are failing", Template: "delivery_failing",
		Data: failing{OrgName: "Acme", DestinationName: "API", DestinationURL: "https://api.example.com", EndpointName: "Stripe", LastResult: "timeout", URL: "https://hookline.test/acme/deliveries"},
	})
	require.NoError(t, err)
	select {
	case body := <-got:
		assert.Contains(t, body, "Subject: Deliveries are failing")
		assert.Contains(t, body, "To: owner@example.com")
	case <-time.After(5 * time.Second):
		t.Fatal("no message")
	}
}

func TestNewSMTPValidates(t *testing.T) {
	_, err := mail.NewSMTP("localhost:25", "a@b.c")
	require.Error(t, err)
	_, err = mail.NewSMTP("smtp://localhost:25", "not an address")
	require.Error(t, err)
}
