package timenavigation

import (
	"fmt"
	"time"
)

type Shortcut struct {
	ID        string `json:"id"`
	Timeframe string `json:"timeframe"`
	Tooltip   string `json:"tooltip"`
}

type Hotkey struct {
	Label  string `json:"label"`
	Key    string `json:"key"`
	AltKey bool   `json:"altKey"`
}

type GoToCapabilities struct {
	Hotkey                 Hotkey   `json:"hotkey"`
	SpecificTimeTimeframes []string `json:"specificTimeTimeframes"`
}

// TimeZoneCapabilities separates the immutable MT5 data clock from the chart's
// backend-owned Exchange display clock. Candle timestamps remain UTC; clients
// use Exchange as an IANA presentation/input timezone.
type TimeZoneCapabilities struct {
	Exchange string `json:"exchange"`
	Data     string `json:"data"`
}

type CatalogResponse struct {
	Shortcuts []Shortcut           `json:"shortcuts"`
	GoTo      GoToCapabilities     `json:"goTo"`
	TimeZone  TimeZoneCapabilities `json:"timeZone"`
}

type Resolution struct {
	Shortcut  string `json:"shortcut"`
	Timeframe string `json:"timeframe"`
	Tooltip   string `json:"tooltip"`
	Mode      string `json:"mode"`
	From      *int64 `json:"from,omitempty"`
	To        *int64 `json:"to,omitempty"`
}

var shortcuts = []Shortcut{
	{ID: "1D", Timeframe: "1m", Tooltip: "1 day in 1 minute intervals"},
	{ID: "5D", Timeframe: "5m", Tooltip: "5 days in 5 minutes intervals"},
	{ID: "1M", Timeframe: "30m", Tooltip: "1 month in 30 minutes intervals"},
	{ID: "3M", Timeframe: "1H", Tooltip: "3 months in 1 hour intervals"},
	{ID: "6M", Timeframe: "2H", Tooltip: "6 months in 2 hours intervals"},
	{ID: "YTD", Timeframe: "1D", Tooltip: "Year to date in 1 day intervals"},
	{ID: "1Y", Timeframe: "1W", Tooltip: "1 year in 1 week intervals"},
	{ID: "5Y", Timeframe: "1W", Tooltip: "5 years in 1 week intervals"},
	{ID: "All", Timeframe: "1M", Tooltip: "All data in 1 month intervals"},
}

func Shortcuts() []Shortcut {
	result := make([]Shortcut, len(shortcuts))
	copy(result, shortcuts)
	return result
}

const defaultExchangeTimeZone = "UTC"

func Catalog(exchangeTimeZones ...string) CatalogResponse {
	exchangeTimeZone := defaultExchangeTimeZone
	if len(exchangeTimeZones) > 0 && exchangeTimeZones[0] != "" {
		exchangeTimeZone = exchangeTimeZones[0]
	}
	return CatalogResponse{
		Shortcuts: Shortcuts(),
		GoTo: GoToCapabilities{
			Hotkey: Hotkey{Label: "Alt+G", Key: "g", AltKey: true},
			SpecificTimeTimeframes: []string{
				"1m", "3m", "5m", "15m", "30m", "1H", "2H",
			},
		},
		TimeZone: TimeZoneCapabilities{
			Exchange: exchangeTimeZone,
			Data:     "UTC",
		},
	}
}

func Resolve(id string, anchorUnix int64) (Resolution, error) {
	var selected *Shortcut
	for i := range shortcuts {
		if shortcuts[i].ID == id {
			selected = &shortcuts[i]
			break
		}
	}
	if selected == nil {
		return Resolution{}, fmt.Errorf("unsupported shortcut %q", id)
	}

	result := Resolution{
		Shortcut:  selected.ID,
		Timeframe: selected.Timeframe,
		Tooltip:   selected.Tooltip,
		Mode:      "range",
	}
	if id == "All" {
		result.Mode = "all"
		return result, nil
	}
	if anchorUnix <= 0 {
		return Resolution{}, fmt.Errorf("anchorTime must be a positive Unix timestamp")
	}

	anchor := time.Unix(anchorUnix, 0).UTC()
	var from time.Time
	switch id {
	case "1D":
		from = anchor.AddDate(0, 0, -1)
	case "5D":
		from = anchor.AddDate(0, 0, -5)
	case "1M":
		from = anchor.AddDate(0, -1, 0)
	case "3M":
		from = anchor.AddDate(0, -3, 0)
	case "6M":
		from = anchor.AddDate(0, -6, 0)
	case "YTD":
		from = time.Date(anchor.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	case "1Y":
		from = anchor.AddDate(-1, 0, 0)
	case "5Y":
		from = anchor.AddDate(-5, 0, 0)
	}

	fromUnix := from.Unix()
	toUnix := anchor.Unix()
	result.From = &fromUnix
	result.To = &toUnix
	return result, nil
}
