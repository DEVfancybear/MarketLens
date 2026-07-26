package execution

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxEAProxyBytes = 256 * 1024

type EAProxy struct {
	baseURL    *url.URL
	httpClient *http.Client
}

type EAProxyResponse struct {
	StatusCode int
	Body       []byte
}

func NewEAProxy(baseURL string) (*EAProxy, error) {
	parsed, err := parseLoopbackHTTPURL(baseURL)
	if err != nil {
		return nil, errors.New("invalid execution EA URL")
	}
	return &EAProxy{
		baseURL: parsed,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (p *EAProxy) Forward(
	ctx context.Context,
	method string,
	path string,
	authorization string,
	body []byte,
) (EAProxyResponse, error) {
	if len(body) > maxEAProxyBytes {
		return EAProxyResponse{}, errors.New("EA request body exceeds proxy limit")
	}
	endpoint := *p.baseURL
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + path
	endpoint.RawQuery = ""
	endpoint.Fragment = ""

	request, err := http.NewRequestWithContext(
		ctx,
		method,
		endpoint.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		return EAProxyResponse{}, fmt.Errorf("create EA proxy request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "smc-execution-ea-proxy/1")
	if len(body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}

	response, err := p.httpClient.Do(request)
	if err != nil {
		return EAProxyResponse{}, fmt.Errorf("call EA gateway: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxEAProxyBytes+1))
	if err != nil {
		return EAProxyResponse{}, fmt.Errorf("read EA gateway response: %w", err)
	}
	if len(payload) > maxEAProxyBytes {
		return EAProxyResponse{}, errors.New("EA gateway response exceeds proxy limit")
	}
	return EAProxyResponse{StatusCode: response.StatusCode, Body: payload}, nil
}
