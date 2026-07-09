package pineruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

const vsaSource = `//@version=4
study(title="VSA Wyckoff Volume", shorttitle="VSA Wyckoff Volume", format=format.volume, resolution="")
showMA = input(defval=false, title="Show Volume Moving Average")
lengthVolumeMA = input(defval=20, title="Length of MA applied on Volume", type=input.integer)
ratioUltraVolume = input(defval=2.2, title="Ultra High Volume Ratio", type=input.float)
ratioVeryHighVolume = input(defval=1.8, title="Very High Volume Ratio", type=input.float)
ratioHighVolume = input(defval=1.2, title="High Volume Ratio", type=input.float)
ratioNormalVolume = input(defval=0.8, title="Normal Volume Ratio", type=input.float)
ratioLowVolume = input(defval=0.4, title="Low Volume Ratio", type=input.float)
float volumeMA = 0
volumeMA := nz(volumeMA[1]) + (volume-nz(volumeMA[1])) / lengthVolumeMA
ultraHighVolumeMin = volumeMA * ratioUltraVolume
veryHighVolumeMin = volumeMA * ratioVeryHighVolume
highVolumeMin = volumeMA * ratioHighVolume
normalVolumeMin = volumeMA * ratioNormalVolume
lowVolumeMin = volumeMA * ratioLowVolume
volUltraHigh = volume >= ultraHighVolumeMin ? true : false
volVeryHigh = volume >= veryHighVolumeMin and volume < ultraHighVolumeMin ? true : false
volHigh = volume >= highVolumeMin and volume < veryHighVolumeMin ? true : false
volNormal = volume >= normalVolumeMin and volume < highVolumeMin ? true : false
volLow = volume >= lowVolumeMin and volume < normalVolumeMin ? true : false
palette = volUltraHigh ? color.purple : volVeryHigh ? color.red : volHigh ? color.orange : volNormal ? color.green : volLow ? color.blue : color.silver
plot(volume, color = palette, style=plot.style_columns, title="Volume", transp=0)
plot(showMA ? volumeMA : na, style=plot.style_line, color=color.green, title="Volume MA")`

const betterRSISource = `//@version=3
study("Better RSI")
cycler = na
myPeriod = input(defval = 14, type=integer, title="Period")
src = input(close, type=source)
showCycler = input(true,'Show cycler?')
lvl = input(50, 'Cycler level on plot')
myRSI = rsi(src, myPeriod)
firstcolor = color(white,10)
secondcolor = color(orange,50)
thirdcolor = gray
h30 = hline(30,color=firstcolor,linestyle=dashed,title='Low')
h70 = hline(70,color=firstcolor,linestyle=dashed,title = 'High')
h20 = hline(20, color=secondcolor,linestyle = solid,title='Second low')
h80 = hline(80, color=secondcolor,linestyle=solid,title='Second high')
h40 = hline(40, color = thirdcolor, linestyle = dashed,title = '40 line')
h60 = hline(60, color = thirdcolor, linestyle = dashed, title = '60 line')
fill(h30,h70,fuchsia,transp=90, title= 'Background color')
RSIplot = plot(myRSI,color=white,linewidth=2,transp=0,title="RSI")
plot(myRSI >= 70 or myRSI<= 30? myRSI:na,style = linebr,linewidth=3,color=red,transp = 0, title = 'Oversold color')
cycler := if myRSI > 69 or myRSI< 31
    a = if myRSI > 69
        1
    else
        2
    a
else
    b = if (nz(cycler[1]) == 1 and myRSI < 39) or (nz(cycler[1]) == 2 and myRSI > 61)
        0
    else
        nz(cycler[1])
    b
mycolor = if cycler == 0
    white
else
    c = if cycler == 1
        lime
    else
        red
    c
plot(showCycler? lvl:na, style = line, color = mycolor, transp = 30, linewidth=2, title  = 'Cycler colors')`

func sampleCandles(n int) []Candle {
	candles := make([]Candle, n)
	price := 100.0
	for i := range candles {
		close := price + float64((i%7)-3)*0.7
		if i%37 == 0 {
			close += 7
		}
		high := max(price, close) + 1.2
		low := min(price, close) - 1.2
		candles[i] = Candle{
			Time:   1783420800 + int64(i*900),
			Open:   price,
			High:   high,
			Low:    low,
			Close:  close,
			Volume: 40 + float64((i*17)%220),
		}
		price = close
	}
	return candles
}

func TestExtractMetaInputsAndStyles(t *testing.T) {
	meta := ExtractMeta(vsaSource)
	if meta.Name != "VSA Wyckoff Volume" || meta.Overlay {
		t.Fatalf("unexpected meta: %+v", meta)
	}
	inputs := ExtractInputs(vsaSource)
	if len(inputs) < 7 {
		t.Fatalf("expected VSA inputs, got %d", len(inputs))
	}
	if inputs[0].Key != "showMA" || inputs[0].Kind != "bool" {
		t.Fatalf("unexpected first input: %+v", inputs[0])
	}
	styles := ExtractStyles(betterRSISource)
	if len(styles) < 8 {
		t.Fatalf("expected RSI plot/hline/fill styles, got %d", len(styles))
	}
}

func TestCompileVSAProducesColoredHistogram(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "vsa",
		SourceCode: vsaSource,
		Candles:    sampleCandles(160),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.Result.Series) == 0 {
		t.Fatalf("expected series")
	}
	series := resp.Result.Series[0]
	if series.Type != "histogram" {
		t.Fatalf("expected histogram, got %+v", series.Type)
	}
	colors := map[string]bool{}
	for _, point := range series.Data {
		if point.Color != nil {
			colors[*point.Color] = true
		}
	}
	if len(colors) < 3 {
		t.Fatalf("expected multiple VSA palette colors, got %+v", colors)
	}
}

func TestCompileBetterRSIProducesBandsAndPlots(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "rsi",
		SourceCode: betterRSISource,
		Candles:    sampleCandles(220),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.Result.Series) < 8 {
		t.Fatalf("expected hlines/fill/plots, got %d", len(resp.Result.Series))
	}
	foundRSI := false
	for _, series := range resp.Result.Series {
		if series.Key == "RSI" && len(series.Data) > 0 {
			foundRSI = true
		}
	}
	if !foundRSI {
		t.Fatalf("missing RSI plot: %+v", resp.Result.Series)
	}
}

func TestCompileReportsUnsupportedObjectRuntime(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID: "objects",
		SourceCode: `indicator("Objects", overlay=true)
var line ln = na
ln := line.new(bar_index, close, bar_index, close)
line.set_x2(ln, bar_index)`,
		Candles: sampleCandles(20),
	})
	if len(resp.UnsupportedFeatures) == 0 {
		t.Fatalf("expected unsupported object feature")
	}
}

func TestHandlerCompileUsesHTTPContract(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	body := `{"scriptId":"vsa","sourceCode":` + quoteJSON(vsaSource) + `,"candles":` + candlesJSON(sampleCandles(80)) + `}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pine-runtime/compile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("compile route: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var decoded CompileResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.Result.ID != "vsa" || len(decoded.Result.Series) == 0 {
		t.Fatalf("bad response: %+v", decoded)
	}
}

func quoteJSON(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func candlesJSON(value []Candle) string {
	data, _ := json.Marshal(value)
	return string(data)
}
