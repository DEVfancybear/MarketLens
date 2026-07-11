package simtrading

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

var (
	ErrNotFound   = errors.New("sim trading: not found")
	ErrBadRequest = errors.New("sim trading: bad request")
)

type Account struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	StartingEquity float64   `json:"startingEquity"`
	Equity         float64   `json:"equity"`
	Currency       string    `json:"currency"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type AccountWrite struct {
	Name           string  `json:"name"`
	StartingEquity float64 `json:"startingEquity"`
	Currency       string  `json:"currency"`
}

type Fill struct {
	Time     int64   `json:"time"`
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Kind     string  `json:"kind"`
}

type Position struct {
	ID            string     `json:"id"`
	ClientID      string     `json:"clientId"`
	Symbol        string     `json:"symbol"`
	Side          string     `json:"side"`
	Type          string     `json:"type"`
	Status        string     `json:"status"`
	Entry         float64    `json:"entry"`
	Quantity      float64    `json:"quantity"`
	Remaining     float64    `json:"remaining"`
	StopLoss      *float64   `json:"stopLoss,omitempty"`
	TakeProfit    *float64   `json:"takeProfit,omitempty"`
	RiskPct       *float64   `json:"riskPct,omitempty"`
	RiskAmount    float64    `json:"riskAmount"`
	RealizedPnL   float64    `json:"realizedPnl"`
	UnrealizedPnL float64    `json:"unrealizedPnl"`
	Fills         []Fill     `json:"fills"`
	Notes         string     `json:"notes,omitempty"`
	OpenTime      *time.Time `json:"openTime,omitempty"`
	CloseTime     *time.Time `json:"closeTime,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type PositionWrite struct {
	ClientID      string          `json:"clientId"`
	Symbol        string          `json:"symbol"`
	Side          string          `json:"side"`
	Type          string          `json:"type"`
	Status        string          `json:"status"`
	Entry         float64         `json:"entry"`
	Quantity      float64         `json:"quantity"`
	Remaining     float64         `json:"remaining"`
	StopLoss      *float64        `json:"stopLoss"`
	TakeProfit    *float64        `json:"takeProfit"`
	RiskPct       *float64        `json:"riskPct"`
	RiskAmount    float64         `json:"riskAmount"`
	RealizedPnL   float64         `json:"realizedPnl"`
	UnrealizedPnL float64         `json:"unrealizedPnl"`
	Fills         json.RawMessage `json:"fills"`
	Notes         string          `json:"notes"`
	OpenTime      *time.Time      `json:"openTime"`
	CloseTime     *time.Time      `json:"closeTime"`
}

type AnalyticsSummary struct {
	TotalTrades       int     `json:"totalTrades"`
	Wins              int     `json:"wins"`
	Losses            int     `json:"losses"`
	Breakeven         int     `json:"breakeven"`
	WinRate           float64 `json:"winRate"`
	ProfitFactor      float64 `json:"profitFactor"`
	AvgRR             float64 `json:"avgRR"`
	AvgWin            float64 `json:"avgWin"`
	AvgLoss           float64 `json:"avgLoss"`
	Expectancy        float64 `json:"expectancy"`
	NetPnL            float64 `json:"netPnl"`
	GrossProfit       float64 `json:"grossProfit"`
	GrossLoss         float64 `json:"grossLoss"`
	MaxDrawdown       float64 `json:"maxDrawdown"`
	MaxDrawdownPct    float64 `json:"maxDrawdownPct"`
	LargestWin        float64 `json:"largestWin"`
	LargestLoss       float64 `json:"largestLoss"`
	LongestWinStreak  int     `json:"longestWinStreak"`
	LongestLossStreak int     `json:"longestLossStreak"`
}
type EquityPoint struct {
	Time     int64   `json:"time"`
	Equity   float64 `json:"equity"`
	Drawdown float64 `json:"drawdown"`
}
type MonthlyStat struct {
	Month   string  `json:"month"`
	PnL     float64 `json:"pnl"`
	Trades  int     `json:"trades"`
	WinRate float64 `json:"winRate"`
}
type DistributionBucket struct {
	Label string  `json:"label"`
	Count int     `json:"count"`
	PnL   float64 `json:"pnl"`
}
type Analytics struct {
	Summary      AnalyticsSummary     `json:"summary"`
	Equity       []EquityPoint        `json:"equity"`
	Monthly      []MonthlyStat        `json:"monthly"`
	Distribution []DistributionBucket `json:"distribution"`
}

func normalizeAccount(in AccountWrite) (AccountWrite, error) {
	in.Name, in.Currency = strings.TrimSpace(in.Name), strings.ToUpper(strings.TrimSpace(in.Currency))
	if in.Name == "" {
		in.Name = "Default"
	}
	if in.Currency == "" {
		in.Currency = "USD"
	}
	if in.StartingEquity == 0 {
		in.StartingEquity = 10000
	}
	if len(in.Name) > 120 || len(in.Currency) < 3 || len(in.Currency) > 12 || !finite(in.StartingEquity) || in.StartingEquity <= 0 {
		return AccountWrite{}, fmt.Errorf("%w: invalid account", ErrBadRequest)
	}
	return in, nil
}

func normalizePosition(in PositionWrite) (PositionWrite, error) {
	in.ClientID, in.Symbol, in.Side, in.Type, in.Status = strings.TrimSpace(in.ClientID), strings.TrimSpace(in.Symbol), strings.ToLower(in.Side), strings.ToLower(in.Type), strings.ToLower(in.Status)
	if in.ClientID == "" || in.Symbol == "" || len(in.Symbol) > 80 || (in.Side != "long" && in.Side != "short") || (in.Type != "market" && in.Type != "limit" && in.Type != "stop") || (in.Status != "pending" && in.Status != "open" && in.Status != "closed" && in.Status != "cancelled") {
		return PositionWrite{}, fmt.Errorf("%w: invalid position identity or state", ErrBadRequest)
	}
	values := []float64{in.Entry, in.Quantity, in.Remaining, in.RiskAmount, in.RealizedPnL, in.UnrealizedPnL}
	for _, v := range values {
		if !finite(v) {
			return PositionWrite{}, fmt.Errorf("%w: numeric fields must be finite", ErrBadRequest)
		}
	}
	if in.Entry <= 0 || in.Quantity <= 0 || in.Remaining < 0 || in.Remaining > in.Quantity || in.RiskAmount < 0 {
		return PositionWrite{}, fmt.Errorf("%w: invalid position quantities", ErrBadRequest)
	}
	if len(in.Fills) == 0 {
		in.Fills = json.RawMessage(`[]`)
	}
	var fills []Fill
	if !json.Valid(in.Fills) || json.Unmarshal(in.Fills, &fills) != nil {
		return PositionWrite{}, fmt.Errorf("%w: invalid fills", ErrBadRequest)
	}
	for _, f := range fills {
		if f.Time < 0 || !finite(f.Price) || f.Price <= 0 || !finite(f.Quantity) || (f.Kind != "open" && f.Kind != "partial" && f.Kind != "close") {
			return PositionWrite{}, fmt.Errorf("%w: invalid fill", ErrBadRequest)
		}
	}
	if in.Status == "closed" && (in.Remaining != 0 || in.CloseTime == nil) {
		return PositionWrite{}, fmt.Errorf("%w: closed position requires closeTime and zero remaining", ErrBadRequest)
	}
	return in, nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
