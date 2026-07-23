package settings

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
)

const (
	mt5ConnectorTicketTTL      = 2 * time.Minute
	mt5ConnectorSessionTTL     = 15 * time.Minute
	mt5ConnectorTicketsPerUser = 8
	mt5ConnectorTicketsGlobal  = 4096
)

type mt5ConnectorTicket struct {
	UserID              string
	Login               string
	Server              string
	PasswordFingerprint [sha256.Size]byte
	VerifiedAt          time.Time
	ExpiresAt           time.Time
}

// mt5ConnectorTicketStore holds short-lived, one-use pairing tickets in memory.
// Only a SHA-256 digest is retained, so an API memory dump cannot replay an
// unconsumed browser ticket directly. Small per-user and global caps support
// normal multi-tab use without allowing the short-lived map to grow unchecked.
type mt5ConnectorTicketStore struct {
	mu      sync.Mutex
	tickets map[[sha256.Size]byte]mt5ConnectorTicket
	now     func() time.Time
	ttl     time.Duration
}

func newMT5ConnectorTicketStore() *mt5ConnectorTicketStore {
	return &mt5ConnectorTicketStore{
		tickets: make(map[[sha256.Size]byte]mt5ConnectorTicket),
		now:     time.Now,
		ttl:     mt5ConnectorTicketTTL,
	}
}

func (s *mt5ConnectorTicketStore) issue(record IntegrationRecord, userID string) (string, mt5ConnectorTicket, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", mt5ConnectorTicket{}, err
	}
	ticket := base64.RawURLEncoding.EncodeToString(raw)
	digest := sha256.Sum256([]byte(ticket))
	now := s.now().UTC()
	entry := mt5ConnectorTicket{
		UserID:              userID,
		Login:               strings.TrimSpace(record.MT5Login),
		Server:              strings.TrimSpace(record.MT5Server),
		PasswordFingerprint: sha256.Sum256(record.MT5Password),
		VerifiedAt:          record.MT5VerifiedAt.UTC(),
		ExpiresAt:           now.Add(s.ttl),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	s.makeRoomLocked(userID)
	s.tickets[digest] = entry
	return ticket, entry, nil
}

func (s *mt5ConnectorTicketStore) consume(ticket string) (mt5ConnectorTicket, bool) {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" || len(ticket) > 256 {
		return mt5ConnectorTicket{}, false
	}
	digest := sha256.Sum256([]byte(ticket))
	now := s.now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	entry, ok := s.tickets[digest]
	if !ok {
		return mt5ConnectorTicket{}, false
	}
	delete(s.tickets, digest)
	if !now.Before(entry.ExpiresAt) {
		return mt5ConnectorTicket{}, false
	}
	return entry, true
}

func (s *mt5ConnectorTicketStore) pruneLocked(now time.Time) {
	for digest, entry := range s.tickets {
		if now.Before(entry.ExpiresAt) {
			continue
		}
		delete(s.tickets, digest)
	}
}

func (s *mt5ConnectorTicketStore) makeRoomLocked(userID string) {
	for {
		userCount := 0
		var oldestDigest [sha256.Size]byte
		var oldestExpiry time.Time
		for digest, entry := range s.tickets {
			if entry.UserID != userID {
				continue
			}
			userCount++
			if oldestExpiry.IsZero() || entry.ExpiresAt.Before(oldestExpiry) {
				oldestDigest = digest
				oldestExpiry = entry.ExpiresAt
			}
		}
		if userCount < mt5ConnectorTicketsPerUser {
			break
		}
		delete(s.tickets, oldestDigest)
	}
	for len(s.tickets) >= mt5ConnectorTicketsGlobal {
		var oldestDigest [sha256.Size]byte
		var oldestExpiry time.Time
		for digest, entry := range s.tickets {
			if oldestExpiry.IsZero() || entry.ExpiresAt.Before(oldestExpiry) {
				oldestDigest = digest
				oldestExpiry = entry.ExpiresAt
			}
		}
		delete(s.tickets, oldestDigest)
	}
}

func (h *Handler) issueMT5ConnectorTicket(c fiber.Ctx) error {
	record, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	login := strings.TrimSpace(record.MT5Login)
	server := strings.TrimSpace(record.MT5Server)
	if record.MT5VerifiedAt == nil || login == "" || server == "" || len(record.MT5Password) == 0 {
		return mt5VerificationError(c, fiber.StatusConflict, "MT5_VERIFICATION_REQUIRED", "Connect and verify an MT5 account before pairing the Connector")
	}
	if h.mt5ConnectorTickets == nil {
		return mt5VerificationError(c, fiber.StatusServiceUnavailable, "MT5_CONNECTOR_UNAVAILABLE", "MT5 Connector pairing is temporarily unavailable")
	}
	ticket, entry, err := h.mt5ConnectorTickets.issue(record, userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{
		"ok":        true,
		"ticket":    ticket,
		"expiresAt": entry.ExpiresAt.UnixMilli(),
		"account": fiber.Map{
			"login":  entry.Login,
			"server": entry.Server,
		},
	})
}

func (h *Handler) validateMT5ConnectorTicket(c fiber.Ctx) error {
	if h.mt5ConnectorTickets == nil || len(c.Body()) > 4096 {
		return mt5ConnectorTicketUnauthorized(c)
	}
	var request struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(c.Body(), &request); err != nil {
		return mt5ConnectorTicketUnauthorized(c)
	}
	entry, ok := h.mt5ConnectorTickets.consume(request.Ticket)
	if !ok {
		return mt5ConnectorTicketUnauthorized(c)
	}
	record, err := h.integrationStore.Get(c.Context(), entry.UserID)
	if err != nil {
		return mt5ConnectorTicketUnauthorized(c)
	}
	currentVerifiedAt := record.MT5VerifiedAt
	credentialsUnchanged := currentVerifiedAt != nil &&
		currentVerifiedAt.Equal(entry.VerifiedAt) &&
		strings.TrimSpace(record.MT5Login) == entry.Login &&
		strings.EqualFold(strings.TrimSpace(record.MT5Server), entry.Server) &&
		sha256.Sum256(record.MT5Password) == entry.PasswordFingerprint
	if !credentialsUnchanged {
		return mt5ConnectorTicketUnauthorized(c)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	sessionExpiresAt := time.Now().UTC().Add(mt5ConnectorSessionTTL)
	return c.JSON(fiber.Map{
		"ok":        true,
		"expiresAt": sessionExpiresAt.UnixMilli(),
		"account": fiber.Map{
			"login":  entry.Login,
			"server": entry.Server,
		},
	})
}

func mt5ConnectorTicketUnauthorized(c fiber.Ctx) error {
	return mt5VerificationError(c, fiber.StatusUnauthorized, "MT5_CONNECTOR_TICKET_INVALID", "The MT5 Connector pairing ticket is invalid or expired")
}
