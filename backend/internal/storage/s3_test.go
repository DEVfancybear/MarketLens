package storage

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPresignPutUsesS3CompatibleSigV4(t *testing.T) {
	signer, err := NewS3Signer(Config{
		Endpoint:  "https://account.r2.cloudflarestorage.com",
		Bucket:    "shots",
		Region:    "auto",
		AccessKey: "access",
		SecretKey: "secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	signer.now = func() time.Time { return time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC) }
	raw, err := signer.PresignPut("users/u1/a b.png", 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if u.Host != "shots.account.r2.cloudflarestorage.com" {
		t.Fatalf("unexpected host %q", u.Host)
	}
	if !strings.Contains(u.EscapedPath(), "users/u1/a%20b.png") {
		t.Fatalf("unexpected path %q", u.EscapedPath())
	}
	if u.Query().Get("X-Amz-Signature") == "" || u.Query().Get("X-Amz-Expires") != "600" {
		t.Fatalf("missing signature query: %s", raw)
	}
}
