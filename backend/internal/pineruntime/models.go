package pineruntime

import "time"

const (
	defaultCompileTimeout = 5 * time.Second
	maxSourceBytes        = 256 * 1024
	maxCompileCandles     = 5000
)

type Candle struct {
	Time   int64   `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type ScriptMeta struct {
	Name       string `json:"name"`
	ShortTitle string `json:"shortTitle,omitempty"`
	Overlay    bool   `json:"overlay"`
	Timeframe  string `json:"timeframe,omitempty"`
	// Version and declaration properties are kept with the source metadata so
	// callers can make the same version/limit decisions as the backend VM. The
	// map is intentionally extensible: Pine adds declaration parameters between
	// language versions and unknown properties must not require a transport
	// schema change.
	Version    int            `json:"version,omitempty"`
	Properties map[string]any `json:"properties,omitempty"`
}

type InputValue any

type InputDefinition struct {
	Key          string       `json:"key"`
	Title        string       `json:"title"`
	Kind         string       `json:"kind"`
	DefaultValue InputValue   `json:"defaultValue"`
	Group        string       `json:"group,omitempty"`
	Inline       string       `json:"inline,omitempty"`
	Tooltip      string       `json:"tooltip,omitempty"`
	Options      []InputValue `json:"options,omitempty"`
	Min          *float64     `json:"min,omitempty"`
	Max          *float64     `json:"max,omitempty"`
	Step         *float64     `json:"step,omitempty"`
}

type StyleDefinition struct {
	Key               string `json:"key"`
	Title             string `json:"title"`
	Target            string `json:"target"`
	Group             string `json:"group"`
	DefaultVisible    bool   `json:"defaultVisible"`
	DefaultColor      string `json:"defaultColor"`
	DefaultLineWidth  *int   `json:"defaultLineWidth,omitempty"`
	DefaultLineStyle  *int   `json:"defaultLineStyle,omitempty"`
	SupportsColor     bool   `json:"supportsColor"`
	SupportsLineWidth bool   `json:"supportsLineWidth"`
	SupportsLineStyle bool   `json:"supportsLineStyle"`
}

type LinePoint struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
	Color *string `json:"color,omitempty"`
}

type IndicatorSeries struct {
	Key   string      `json:"key"`
	Color string      `json:"color"`
	Data  []LinePoint `json:"data"`
	Type  string      `json:"type,omitempty"`
	// ValueFormat is the normalized script-level display format. Keeping this
	// semantic in the common runtime contract lets every symbol and every
	// renderer present volume/percent outputs consistently without inspecting
	// script names or formulas in the browser.
	ValueFormat          string   `json:"valueFormat,omitempty"`
	LineWidth            *int     `json:"lineWidth,omitempty"`
	LineStyle            *int     `json:"lineStyle,omitempty"`
	BaseValue            *float64 `json:"baseValue,omitempty"`
	FillBelowBase        *bool    `json:"fillBelowBase,omitempty"`
	LastValueVisible     *bool    `json:"lastValueVisible,omitempty"`
	StatusLineVisible    *bool    `json:"statusLineVisible,omitempty"`
	ExtendToVisibleRange *bool    `json:"extendToVisibleRange,omitempty"`
	LineVisible          *bool    `json:"lineVisible,omitempty"`
	Precision            *int     `json:"precision,omitempty"`
	// Vector drawing compilation uses these internal fields to apply Pine's
	// global object limits in per-bar/source creation order. They intentionally
	// stay out of the transport contract.
	objectCreationIndex int
	objectSourceLine    int
}

type IndicatorOverlayLabel struct {
	Key             string  `json:"key"`
	Price           float64 `json:"price"`
	Text            string  `json:"text"`
	Color           string  `json:"color"`
	BackgroundColor string  `json:"backgroundColor,omitempty"`
	// Style and Tooltip preserve Pine label presentation metadata. They are
	// optional because older/runtime-generated labels may not specify them.
	Style   string `json:"style,omitempty"`
	Tooltip string `json:"tooltip,omitempty"`
	Time    *int64 `json:"time,omitempty"`
	// See IndicatorSeries.objectCreationIndex. Stateful labels are already
	// retained in execution order; vector labels use these fields before JSON
	// serialization and cache publication.
	objectCreationIndex int
	objectSourceLine    int
}

type IndicatorDashboardRow struct {
	Label      string `json:"label"`
	Value      string `json:"value"`
	ValueColor string `json:"valueColor,omitempty"`
}

type IndicatorDashboard struct {
	Key      string                  `json:"key"`
	Title    string                  `json:"title"`
	Subtitle string                  `json:"subtitle,omitempty"`
	Position string                  `json:"position,omitempty"`
	TextSize string                  `json:"textSize,omitempty"`
	Rows     []IndicatorDashboardRow `json:"rows"`
}

type IndicatorResult struct {
	ID        string                  `json:"id"`
	Series    []IndicatorSeries       `json:"series"`
	Labels    []IndicatorOverlayLabel `json:"labels,omitempty"`
	Dashboard *IndicatorDashboard     `json:"dashboard,omitempty"`
}

type RuntimeError struct {
	Message string `json:"message"`
	Line    int    `json:"line,omitempty"`
}

type MetaRequest struct {
	SourceCode string `json:"sourceCode"`
}

type MetaResponse struct {
	Name       string         `json:"name"`
	ShortTitle string         `json:"shortTitle,omitempty"`
	Overlay    bool           `json:"overlay"`
	Timeframe  string         `json:"timeframe,omitempty"`
	Version    int            `json:"version,omitempty"`
	Properties map[string]any `json:"properties,omitempty"`
	Errors     []RuntimeError `json:"errors"`
}

type InputsRequest struct {
	SourceCode     string                `json:"sourceCode"`
	InputOverrides map[string]InputValue `json:"inputOverrides,omitempty"`
}

type InputsResponse struct {
	Inputs []InputDefinition `json:"inputs"`
	Errors []RuntimeError    `json:"errors"`
}

type StylesRequest struct {
	SourceCode     string                `json:"sourceCode"`
	StyleOverrides map[string]InputValue `json:"styleOverrides,omitempty"`
}

type StylesResponse struct {
	Styles []StyleDefinition `json:"styles"`
	Errors []RuntimeError    `json:"errors"`
}

type CompileRequest struct {
	ScriptID       string                `json:"scriptId,omitempty"`
	SourceCode     string                `json:"sourceCode"`
	Timeframe      string                `json:"timeframe,omitempty"`
	Symbol         string                `json:"symbol,omitempty"`
	SymbolType     string                `json:"symbolType,omitempty"`
	Mintick        float64               `json:"mintick,omitempty"`
	Timezone       string                `json:"timezone,omitempty"`
	Candles        []Candle              `json:"candles"`
	InputOverrides map[string]InputValue `json:"inputOverrides,omitempty"`
	StyleOverrides map[string]InputValue `json:"styleOverrides,omitempty"`
	// ReplayCutoff is an inclusive Unix-second execution boundary. It is
	// applied before compilation, so a custom script cannot observe candles
	// beyond the selected replay bar even when this endpoint is called directly.
	ReplayCutoff *int64 `json:"replayCutoff,omitempty"`
}

type CompileResponse struct {
	Meta                ScriptMeta      `json:"meta"`
	Result              IndicatorResult `json:"result"`
	Errors              []RuntimeError  `json:"errors"`
	Warnings            []RuntimeError  `json:"warnings"`
	UnsupportedFeatures []string        `json:"unsupportedFeatures"`
}

// IndicatorDefinition is the single UI/runtime contract for both catalog
// indicators and user Pine source. The browser renders these fields without
// knowing any indicator names or formulas.
type IndicatorDefinition struct {
	Type                   string            `json:"type"`
	Name                   string            `json:"name"`
	ShortTitle             string            `json:"shortTitle,omitempty"`
	Description            string            `json:"description,omitempty"`
	Overlay                bool              `json:"overlay"`
	Timeframe              string            `json:"timeframe,omitempty"`
	Version                int               `json:"version,omitempty"`
	Properties             map[string]any    `json:"properties,omitempty"`
	Inputs                 []InputDefinition `json:"inputs"`
	Styles                 []StyleDefinition `json:"styles"`
	LegacyInputBindings    map[string]string `json:"legacyInputBindings,omitempty"`
	LegacyStyleBindings    map[string]string `json:"legacyStyleBindings,omitempty"`
	RequiresHistoryContext bool              `json:"requiresHistoryContext"`
	SourceAvailable        bool              `json:"sourceAvailable"`
	Shortcut               string            `json:"shortcut,omitempty"`
}

type IndicatorCatalogResponse struct {
	Indicators []IndicatorDefinition `json:"indicators"`
	Errors     []RuntimeError        `json:"errors"`
}

type IndicatorDefinitionRequest struct {
	IndicatorType string `json:"indicatorType,omitempty"`
	SourceCode    string `json:"sourceCode,omitempty"`
}

type IndicatorDefinitionResponse struct {
	Definition IndicatorDefinition `json:"definition"`
	Errors     []RuntimeError      `json:"errors"`
}

// IndicatorRuntimeRequest is the stable contract for every indicator. Config
// stays opaque so definitions can evolve without transport changes. SourceCode
// is present for saved/public user scripts; catalog entries resolve it by type.
type IndicatorRuntimeRequest struct {
	IndicatorType string         `json:"indicatorType"`
	IndicatorID   string         `json:"indicatorId,omitempty"`
	SourceCode    string         `json:"sourceCode,omitempty"`
	Timeframe     string         `json:"timeframe,omitempty"`
	Symbol        string         `json:"symbol,omitempty"`
	SymbolType    string         `json:"symbolType,omitempty"`
	Mintick       float64        `json:"mintick,omitempty"`
	Timezone      string         `json:"timezone,omitempty"`
	Config        map[string]any `json:"config,omitempty"`
	Candles       []Candle       `json:"candles"`
	// ReplayCutoff limits calculation to the replay evaluation boundary supplied
	// by a replay-aware caller. It is expressed as a Unix timestamp in seconds.
	// A nil value preserves live-chart behavior, including right extensions for
	// drawing objects.
	ReplayCutoff *int64 `json:"replayCutoff,omitempty"`
}

type IndicatorRuntimeResponse struct {
	Result   IndicatorResult `json:"result"`
	Errors   []RuntimeError  `json:"errors"`
	Warnings []RuntimeError  `json:"warnings"`
}
