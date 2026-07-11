package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
)

var ErrNotConfigured = errors.New("object storage is not configured")

// Config describes an S3-compatible endpoint (AWS S3, Cloudflare R2 or MinIO).
type Config struct {
	Endpoint     string
	Bucket       string
	Region       string
	AccessKey    string
	SecretKey    string
	SessionToken string
	PathStyle    bool
}

type Signer interface {
	PresignPut(storageKey string, expires time.Duration) (string, error)
	PresignGet(storageKey string, expires time.Duration) (string, error)
}

type S3Signer struct {
	cfg Config
	now func() time.Time
}

func NewS3Signer(cfg Config) (*S3Signer, error) {
	cfg.Endpoint = strings.TrimRight(strings.TrimSpace(cfg.Endpoint), "/")
	cfg.Bucket = strings.TrimSpace(cfg.Bucket)
	cfg.Region = strings.TrimSpace(cfg.Region)
	cfg.AccessKey = strings.TrimSpace(cfg.AccessKey)
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = "https://s3." + cfg.Region + ".amazonaws.com"
	}
	if cfg.Bucket == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, ErrNotConfigured
	}
	if _, err := url.ParseRequestURI(cfg.Endpoint); err != nil {
		return nil, fmt.Errorf("invalid object storage endpoint: %w", err)
	}
	return &S3Signer{cfg: cfg, now: time.Now}, nil
}

func (s *S3Signer) PresignPut(storageKey string, expires time.Duration) (string, error) {
	return s.presign("PUT", storageKey, expires)
}

func (s *S3Signer) PresignGet(storageKey string, expires time.Duration) (string, error) {
	return s.presign("GET", storageKey, expires)
}

func (s *S3Signer) presign(method, storageKey string, expires time.Duration) (string, error) {
	storageKey = strings.TrimLeft(strings.TrimSpace(storageKey), "/")
	if storageKey == "" || strings.Contains(storageKey, "..") {
		return "", errors.New("invalid storage key")
	}
	seconds := int64(expires / time.Second)
	if seconds <= 0 || seconds > 7*24*60*60 {
		return "", errors.New("presign expiry must be between 1 second and 7 days")
	}

	endpoint, err := url.Parse(s.cfg.Endpoint)
	if err != nil {
		return "", err
	}
	escapedKey := strings.Join(strings.Split(storageKey, "/"), "/")
	if s.cfg.PathStyle {
		endpoint.Path = path.Join(endpoint.Path, s.cfg.Bucket, escapedKey)
	} else {
		endpoint.Host = s.cfg.Bucket + "." + endpoint.Host
		endpoint.Path = path.Join(endpoint.Path, escapedKey)
	}
	if !strings.HasPrefix(endpoint.Path, "/") {
		endpoint.Path = "/" + endpoint.Path
	}

	now := s.now().UTC()
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	scope := date + "/" + s.cfg.Region + "/s3/aws4_request"
	query := url.Values{
		"X-Amz-Algorithm":     {"AWS4-HMAC-SHA256"},
		"X-Amz-Credential":    {s.cfg.AccessKey + "/" + scope},
		"X-Amz-Date":          {amzDate},
		"X-Amz-Expires":       {fmt.Sprint(seconds)},
		"X-Amz-SignedHeaders": {"host"},
	}
	if s.cfg.SessionToken != "" {
		query.Set("X-Amz-Security-Token", s.cfg.SessionToken)
	}
	canonicalQuery := awsQuery(query)
	canonicalURI := endpoint.EscapedPath()
	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		"host:" + endpoint.Host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	requestHash := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(requestHash[:])
	signature := hex.EncodeToString(hmacSHA256(signingKey(s.cfg.SecretKey, date, s.cfg.Region), stringToSign))
	query.Set("X-Amz-Signature", signature)
	endpoint.RawQuery = awsQuery(query)
	return endpoint.String(), nil
}

func signingKey(secret, date, region string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+secret), date)
	regionKey := hmacSHA256(dateKey, region)
	serviceKey := hmacSHA256(regionKey, "s3")
	return hmacSHA256(serviceKey, "aws4_request")
}

func hmacSHA256(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(value))
	return h.Sum(nil)
}

// url.Values.Encode uses '+' for spaces; SigV4 requires RFC3986 %20 encoding.
func awsQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		vals := append([]string(nil), values[key]...)
		sort.Strings(vals)
		for _, value := range vals {
			parts = append(parts, awsEscape(key)+"="+awsEscape(value))
		}
	}
	return strings.Join(parts, "&")
}

func awsEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}
