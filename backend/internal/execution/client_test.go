package execution

import "testing"

func TestClientRejectsNonLoopbackAdminURL(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	for _, raw := range []string{
		"https://execution.example.com",
		"http://10.0.0.8:8791",
		"http://127.0.0.1:8791?redirect=evil",
		"http://user:pass@127.0.0.1:8791",
	} {
		if _, err := NewClient(raw, token); err == nil {
			t.Fatalf("NewClient(%q) succeeded, want error", raw)
		}
	}
}

func TestClientAcceptsLoopbackAdminURL(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	for _, raw := range []string{
		"http://127.0.0.1:8791",
		"http://[::1]:8791",
		"http://localhost:8791",
	} {
		if _, err := NewClient(raw, token); err != nil {
			t.Fatalf("NewClient(%q): %v", raw, err)
		}
	}
}
