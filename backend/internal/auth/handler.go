package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/marketlens/backend/internal/config"
)

// Handler exposes the auth endpoints under /auth.
type Handler struct {
	svc         *Service
	cfg         config.Config
	requireAuth fiber.Handler
}

func NewHandler(svc *Service, tokens *TokenService, cfg config.Config) *Handler {
	return &Handler{svc: svc, cfg: cfg, requireAuth: RequireAuth(tokens)}
}

// Register mounts the auth routes on the given router (typically the /api/v1
// group). Protected routes are guarded by RequireAuth.
func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/auth")
	rateLimit := newAuthRateLimiter()
	g.Post("/session", rateLimit, h.session)
	g.Post("/google", rateLimit, h.google)
	g.Post("/refresh", rateLimit, h.refresh)
	g.Post("/logout", h.requireAuth, h.logout)
	g.Get("/me", h.requireAuth, h.me)
	g.Delete("/sessions", h.requireAuth, h.revokeAllSessions)
}

func (h *Handler) google(c fiber.Ctx) error {
	idToken, err := bindIDToken(c)
	if err != nil {
		return err
	}

	res, err := h.svc.LoginWithGoogle(c.Context(), idToken, c.Get("User-Agent"), c.IP())
	if err != nil {
		return authError(err)
	}

	SetAuthCookies(c, h.cfg, res.AccessToken, res.RefreshToken)
	return c.JSON(loginJSON(res))
}

// session establishes the backend cookie session in one request. It validates
// the current Firebase identity before reusing either backend cookie, which
// prevents a Firebase account switch from inheriting another user's workspace.
func (h *Handler) session(c fiber.Ctx) error {
	idToken, err := bindIDToken(c)
	if err != nil {
		return err
	}

	res, err := h.svc.EnsureGoogleSession(
		c.Context(),
		idToken,
		c.Cookies(AccessCookieName),
		c.Cookies(RefreshCookieName),
		c.Get("User-Agent"),
		c.IP(),
	)
	if err != nil {
		return authError(err)
	}
	if res.AccessToken != "" && res.RefreshToken != "" {
		SetAuthCookies(c, h.cfg, res.AccessToken, res.RefreshToken)
	}
	return c.JSON(loginJSON(res))
}

func bindIDToken(c fiber.Ctx) (string, error) {
	var req struct {
		IDToken string `json:"idToken"`
	}
	if err := c.Bind().Body(&req); err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	req.IDToken = strings.TrimSpace(req.IDToken)
	if req.IDToken == "" || len(req.IDToken) > MaxIDTokenLength {
		return "", fiber.NewError(fiber.StatusBadRequest, "valid idToken is required")
	}
	return req.IDToken, nil
}

func loginJSON(res LoginResult) fiber.Map {
	return fiber.Map{
		"user":      userJSON(res.User),
		"isNewUser": res.IsNewUser,
	}
}

func (h *Handler) refresh(c fiber.Ctx) error {
	raw := c.Cookies(RefreshCookieName)
	if raw == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	}

	pair, err := h.svc.Refresh(c.Context(), raw, c.Get("User-Agent"), c.IP())
	if err != nil {
		// A revoked/reused/expired refresh token is dead — clear the cookies so
		// the client stops replaying it.
		ClearAuthCookies(c, h.cfg)
		return authError(err)
	}

	SetAuthCookies(c, h.cfg, pair.AccessToken, pair.RefreshToken)
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) logout(c fiber.Ctx) error {
	sessionID, _ := c.Locals(LocalSessionID).(string)
	if err := h.svc.Logout(c.Context(), sessionID); err != nil {
		return authError(err)
	}
	ClearAuthCookies(c, h.cfg)
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) me(c fiber.Ctx) error {
	userID, _ := c.Locals(LocalUserID).(string)
	user, err := h.svc.GetUser(c.Context(), userID)
	if err != nil {
		// The access token is valid but the user is gone — treat as unauthorized.
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	}
	return c.JSON(userJSON(user))
}

func (h *Handler) revokeAllSessions(c fiber.Ctx) error {
	userID, _ := c.Locals(LocalUserID).(string)
	if err := h.svc.RevokeAllSessions(c.Context(), userID); err != nil {
		return authError(err)
	}
	ClearAuthCookies(c, h.cfg)
	return c.JSON(fiber.Map{"ok": true})
}

// userJSON renders the public user object (API.md §Auth).
func userJSON(u User) fiber.Map {
	return fiber.Map{
		"id":          u.ID,
		"email":       u.Email,
		"displayName": u.DisplayName,
		"photoUrl":    u.PhotoURL,
		"createdAt":   u.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// authError maps a service error to a Fiber error the central ErrorHandler will
// format. Auth failures (bad token, reuse) surface as 401; everything else 500.
func authError(err error) error {
	switch {
	case errors.Is(err, ErrUnauthorized), errors.Is(err, ErrSessionReuse):
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	case errors.Is(err, ErrIdentityProviderUnavailable):
		return fiber.NewError(fiber.StatusServiceUnavailable, "identity provider unavailable")
	default:
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
}
