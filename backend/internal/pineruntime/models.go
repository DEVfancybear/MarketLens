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
	Key                  string      `json:"key"`
	Color                string      `json:"color"`
	Data                 []LinePoint `json:"data"`
	Type                 string      `json:"type,omitempty"`
	LineWidth            *int        `json:"lineWidth,omitempty"`
	LineStyle            *int        `json:"lineStyle,omitempty"`
	BaseValue            *float64    `json:"baseValue,omitempty"`
	LastValueVisible     *bool       `json:"lastValueVisible,omitempty"`
	StatusLineVisible    *bool       `json:"statusLineVisible,omitempty"`
	ExtendToVisibleRange *bool       `json:"extendToVisibleRange,omitempty"`
	LineVisible          *bool       `json:"lineVisible,omitempty"`
	Precision            *int        `json:"precision,omitempty"`
}

type IndicatorOverlayLabel struct {
	Key             string  `json:"key"`
	Price           float64 `json:"price"`
	Text            string  `json:"text"`
	Color           string  `json:"color"`
	BackgroundColor string  `json:"backgroundColor,omitempty"`
	Time            *int64  `json:"time,omitempty"`
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
	Candles        []Candle              `json:"candles"`
	InputOverrides map[string]InputValue `json:"inputOverrides,omitempty"`
	StyleOverrides map[string]InputValue `json:"styleOverrides,omitempty"`
}

type CompileResponse struct {
	Meta                ScriptMeta      `json:"meta"`
	Result              IndicatorResult `json:"result"`
	Errors              []RuntimeError  `json:"errors"`
	Warnings            []RuntimeError  `json:"warnings"`
	UnsupportedFeatures []string        `json:"unsupportedFeatures"`
}

// IndicatorRuntimeRequest is the stable backend-owned contract for built-in
// indicators. Config is intentionally opaque JSON-shaped data so adding a new
// indicator does not require changing this transport type; the registry
// validates and consumes only the fields its calculator declares.
type IndicatorRuntimeRequest struct {
	IndicatorType string         `json:"indicatorType"`
	IndicatorID   string         `json:"indicatorId,omitempty"`
	Config        map[string]any `json:"config,omitempty"`
	Candles       []Candle       `json:"candles"`
}

type IndicatorRuntimeResponse struct {
	Result   IndicatorResult `json:"result"`
	Errors   []RuntimeError  `json:"errors"`
	Warnings []RuntimeError  `json:"warnings"`
}
