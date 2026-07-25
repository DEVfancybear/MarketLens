package pineruntime

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
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

const adrSource = `//@version=5
indicator("ADR 50 SR Pro", overlay=true, max_lines_count=500, max_labels_count=500, max_boxes_count=500)
adrPeriod    = input.int(10, "ADR Period", options=[5, 10, 20], group="Calculation")
showLabels   = input.bool(true,  "Show Labels", group="Display")
showZones    = input.bool(true,  "Show Zones", group="Display")
zoneWidthPct = input.float(2.0,  "Zone Width % (of ADR)", minval=0.0, step=0.5, group="Display")
showDash     = input.bool(true,  "Show Dashboard", group="Display")
showAdrDate  = input.bool(true,  "Show ADR Date", group="Display")
showDistance = input.bool(true,  "Show Distance", group="Display")
lineWidth    = input.int(2, "Line Width", minval=1, maxval=5, group="Style")
colHigh    = input.color(color.red,   "ADR H50 Color", group="Colors")
colLow     = input.color(color.green, "ADR L50 Color", group="Colors")
zoneTransp = input.int(85, "Zone Transparency", minval=0, maxval=100, group="Colors")
adr   = request.security(syminfo.tickerid, "D", ta.sma(high - low, adrPeriod)[1], lookahead=barmerge.lookahead_off)
dOpen = request.security(syminfo.tickerid, "D", open, lookahead=barmerge.lookahead_off)
todayRange = request.security(syminfo.tickerid, "D", high - low, lookahead=barmerge.lookahead_off)
lastDayTime = request.security(syminfo.tickerid, "D", time[1], lookahead=barmerge.lookahead_off)
h50 = dOpen + adr * 0.50
l50 = dOpen - adr * 0.50
zoneHalf = adr * (zoneWidthPct / 100.0) / 2.0
newDay = ta.change(time("D")) != 0
isForex  = syminfo.type == "forex"
unitSize = isForex ? syminfo.mintick * 10.0 : syminfo.mintick
unitName = isForex ? "pips" : "pts"
toUnits(float priceDiff) => unitSize > 0 ? priceDiff / unitSize : priceDiff
var line  lnHigh = na
var line  lnLow  = na
var label lbHigh = na
var label lbLow  = na
var box   bxHigh = na
var box   bxLow  = na
if newDay
    lnHigh := line.new(bar_index, h50, bar_index, h50, color=colHigh, width=lineWidth, style=line.style_solid)
    lnLow  := line.new(bar_index, l50, bar_index, l50, color=colLow,  width=lineWidth, style=line.style_solid)
    bxHigh := box.new(bar_index, h50 + zoneHalf, bar_index, h50 - zoneHalf, border_color=na, bgcolor = showZones ? color.new(colHigh, zoneTransp) : na)
    bxLow  := box.new(bar_index, l50 + zoneHalf, bar_index, l50 - zoneHalf, border_color=na, bgcolor = showZones ? color.new(colLow,  zoneTransp) : na)
    lbHigh := label.new(bar_index, h50, "ADR H50", style=label.style_label_left, color=color.new(color.black, 100), textcolor=colHigh)
    lbLow  := label.new(bar_index, l50, "ADR L50", style=label.style_label_left, color=color.new(color.black, 100), textcolor=colLow)
if not na(lnHigh)
    line.set_x2(lnHigh, bar_index)
    line.set_y1(lnHigh, h50)
    line.set_y2(lnHigh, h50)
    line.set_x2(lnLow, bar_index)
    line.set_y1(lnLow, l50)
    line.set_y2(lnLow, l50)
    box.set_right(bxHigh, bar_index)
    box.set_top(bxHigh, h50 + zoneHalf)
    box.set_bottom(bxHigh, h50 - zoneHalf)
    box.set_bgcolor(bxHigh, showZones ? color.new(colHigh, zoneTransp) : na)
    box.set_right(bxLow, bar_index)
    box.set_top(bxLow, l50 + zoneHalf)
    box.set_bottom(bxLow, l50 - zoneHalf)
    box.set_bgcolor(bxLow, showZones ? color.new(colLow, zoneTransp) : na)
    label.set_xy(lbHigh, bar_index, h50)
    label.set_text(lbHigh, showLabels ? "ADR H50  " + str.tostring(h50, format.mintick) : "")
    label.set_textcolor(lbHigh, showLabels ? colHigh : color.new(colHigh, 100))
    label.set_xy(lbLow, bar_index, l50)
    label.set_text(lbLow, showLabels ? "ADR L50  " + str.tostring(l50, format.mintick) : "")
    label.set_textcolor(lbLow, showLabels ? colLow : color.new(colLow, 100))
hasData = not na(adr)
touchHigh = hasData and low <= h50 and high >= h50
touchLow = hasData and low <= l50 and high >= l50
adrCompletion = adr > 0 ? (todayRange / adr) * 100.0 : 0.0
completionCol = adrCompletion > 100 ? color.red : adrCompletion >= 50 ? color.yellow : color.lime
adrUnits = toUnits(adr)
rangeUnits = toUnits(todayRange)
distHigh = math.abs(toUnits(h50 - close))
distLow = math.abs(toUnits(close - l50))
adrDateStr = str.format_time(lastDayTime, "yyyy-MM-dd", syminfo.timezone)
var table dash = table.new(position.top_right, 2, 8, bgcolor=color.new(color.black, 75), frame_color=color.gray, frame_width=1, border_color=color.new(color.gray, 50), border_width=1)
if showDash and barstate.islast
    table.cell(dash, 0, 0, "ADR 50 SR Pro", text_color=color.aqua)
    table.cell(dash, 1, 0, unitName, text_color=color.gray)
    table.cell(dash, 0, 1, "ADR Period", text_color=color.silver)
    table.cell(dash, 1, 1, str.tostring(adrPeriod), text_color=color.white)
    table.cell(dash, 0, 2, "ADR Value", text_color=color.silver)
    table.cell(dash, 1, 2, str.tostring(adrUnits, "#.#") + " " + unitName, text_color=color.white)
    table.cell(dash, 0, 3, "Today Range", text_color=color.silver)
    table.cell(dash, 1, 3, str.tostring(rangeUnits, "#.#") + " " + unitName, text_color=color.white)
    table.cell(dash, 0, 4, "ADR Completion", text_color=color.silver)
    table.cell(dash, 1, 4, str.tostring(adrCompletion, "#") + "%", text_color=completionCol)
    table.cell(dash, 0, 5, "To H50", text_color=color.silver)
    table.cell(dash, 1, 5, showDistance ? str.tostring(distHigh, "#.#") + " " + unitName : "-", text_color=colHigh)
    table.cell(dash, 0, 6, "To L50", text_color=color.silver)
    table.cell(dash, 1, 6, showDistance ? str.tostring(distLow, "#.#") + " " + unitName : "-", text_color=colLow)
    table.cell(dash, 0, 7, showAdrDate ? "ADR Date" : "", text_color=color.silver)
    table.cell(dash, 1, 7, showAdrDate ? adrDateStr : "", text_color=color.white)`

const multiMovingAverageSource = `//@version=5
indicator(title='10 in 1 Different Moving Averages ( SMA/EMA/WMA/RMA/HMA/VWMA )', shorttitle=' 10 in 1 MAs', overlay=true)

bool plot_ma_1 = input.bool(true, 'MA 1', inline='ma1', group=" Simple Moving averages")
string ma_1_type = input.string(defval='EMA', title='', inline='ma1', options=['RMA', 'SMA', 'EMA', 'WMA','HMA','VWMA'], group=" Simple Moving averages")
int ma_1_val = input.int(200, '', minval=1, inline='ma1', group=" Simple Moving averages")
string ma1_res = input.string(title='', defval='Normal MA', inline='ma1', options=["Normal MA","Open","High","Low","Close","hl2","hlc3","ohlc4","hlcc4","Multitimeframe MA","Chart","1 Minute","Day"], group=" Simple Moving averages")
color ma_1_colour = input.color(color.red, '', inline='ma1', group=" Simple Moving averages")

ma_function(source, length, type) =>
    if type == 'RMA'
        ta.rma(source, length)
    else if type == 'SMA'
        ta.sma(source, length)
    else if type == 'EMA'
        ta.ema(source, length)
    else if type == 'WMA'
        ta.wma(source, length)
    else if type == 'HMA'
        if(length<2)
            ta.hma(source,2)
        else
            ta.hma(source, length)
    else
        ta.vwma(source, length)

type_nor(type)=>
    if (type == "Open") or (type == "High") or (type == "Low") or (type == "Close") or (type == "Normal MA")
        true
    else
        false

tf(res)=>
    if (res == "1 Minute")
        '1'
    else if (res == "Day")
        'D'
    else
        timeframe.period

pr(res)=>
    switch res
        "Open" => open
        "High" => high
        "Low" => low
        "Close" => close
        "hlc3" => hlc3
        "ohlc4" => ohlc4
        "hlcc4" => hlcc4
        => close

ma_1 = plot_ma_1 ? (type_nor(ma1_res) ? ma_function(pr(ma1_res), ma_1_val, ma_1_type) : request.security(syminfo.tickerid, tf(ma1_res), ma_function(close, ma_1_val, ma_1_type))) : na

plot(plot_ma_1 ? ma_1 : na, 'MA 1', ma_1_colour, linewidth=1)`

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

func sampleIntradayCandles(days int) []Candle {
	candles := make([]Candle, 0, days*96)
	price := 100.0
	start := int64(1782864000)
	for i := 0; i < days*96; i++ {
		close := price + float64((i%11)-5)*0.13
		if i%96 == 10 {
			close += 1.8
		}
		if i%96 == 55 {
			close -= 1.1
		}
		high := max(price, close) + 0.35 + float64(i%5)*0.03
		low := min(price, close) - 0.35 - float64(i%3)*0.02
		candles = append(candles, Candle{
			Time:   start + int64(i*900),
			Open:   price,
			High:   high,
			Low:    low,
			Close:  close,
			Volume: 100 + float64((i*19)%300),
		})
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
	vsaStyles := ExtractStyles(vsaSource)
	if len(vsaStyles) != 2 || vsaStyles[0].SupportsColor || !vsaStyles[1].SupportsColor {
		t.Fatalf("VSA dynamic/static color editability = %+v", vsaStyles)
	}
}

func TestCompilePineColorLiteralsInGenericExpressions(t *testing.T) {
	source := `//@version=5
indicator("Color literals")
inputLine = input.color(#26a69a, "Input line")
alphaLine = #ABCDEF80
fadedLine = color.new(#33669980, 25)
plot(close, "input", color = inputLine)
plot(open, "alpha", color = alphaLine)
plot(low, "faded", color = fadedLine)
plot(high, "direct", color = #123456)`
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "color-literals",
		SourceCode: source,
		Candles:    sampleCandles(20),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.Result.Series) != 4 {
		t.Fatalf("series = %+v, want four generic color plots", resp.Result.Series)
	}
	wantColors := []string{"#26a69a", "#ABCDEF80", "rgba(51, 102, 153, 0.750)", "#123456"}
	for index, want := range wantColors {
		series := resp.Result.Series[index]
		if series.Color != want || len(series.Data) != 20 {
			t.Fatalf("series %d = %+v, want color %q and 20 points", index, series, want)
		}
	}
}

func TestCompileRejectsMalformedPineColorLiterals(t *testing.T) {
	for _, literal := range []string{"#12345", "#1234567", "#GG0000"} {
		t.Run(literal, func(t *testing.T) {
			resp := Compile(context.Background(), CompileRequest{
				SourceCode: "indicator(\"Invalid color\")\nlineColor = " + literal + "\nplot(close, color = lineColor)",
				Candles:    sampleCandles(2),
			})
			if len(resp.Errors) == 0 || !strings.Contains(resp.Errors[0].Message, "invalid color literal") {
				t.Fatalf("errors = %+v, want an invalid color literal diagnostic", resp.Errors)
			}
		})
	}
}

func TestCompileVSAProducesColoredHistogram(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "vsa",
		SourceCode: vsaSource,
		Candles:    sampleCandles(160),
		// Simulate an old instance whose UI persisted the former schema
		// fallback. A scalar value must not erase the Pine palette.
		StyleOverrides: map[string]InputValue{"plot:1.color": "#2962ff"},
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
	if series.ValueFormat != "volume" {
		t.Fatalf("expected common volume presentation contract, got %q", series.ValueFormat)
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

func TestCompileUsesMarketContextForSyminfo(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID: "symbol-context",
		SourceCode: `//@version=5
indicator("Symbol context")
value = syminfo.type == "crypto" ? syminfo.mintick : 0
plot(value, title="Tick")`,
		Symbol:     "BTCUSD",
		SymbolType: "crypto",
		Mintick:    0.1,
		Timezone:   "UTC",
		Candles:    sampleCandles(3),
	})
	if len(resp.Errors) > 0 || len(resp.Result.Series) != 1 {
		t.Fatalf("compile response = %+v", resp)
	}
	for _, point := range resp.Result.Series[0].Data {
		if point.Value != 0.1 {
			t.Fatalf("syminfo context was not propagated: %+v", resp.Result.Series[0])
		}
	}
}

func TestCompilePropagatesCommonOutputFormatAndPrecision(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID: "formatted-output",
		SourceCode: `//@version=5
indicator("Formatted", format=format.percent, precision=3)
plot(close)`,
		Candles: sampleCandles(8),
		StyleOverrides: map[string]InputValue{
			outputPrecisionStyleKey: "4",
		},
	})
	if len(resp.Errors) > 0 || len(resp.Result.Series) != 1 {
		t.Fatalf("compile response = %+v", resp)
	}
	series := resp.Result.Series[0]
	if series.ValueFormat != "percent" || series.Precision == nil || *series.Precision != 4 {
		t.Fatalf("series presentation = %+v, want percent precision 4", series)
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
	foundCycler := false
	foundExtendedReference := false
	for _, series := range resp.Result.Series {
		if (series.Type == "line" || series.Type == "baselineFill") &&
			series.ExtendToVisibleRange != nil &&
			*series.ExtendToVisibleRange {
			foundExtendedReference = true
		}
		if series.Key == "RSI" && len(series.Data) > 0 {
			foundRSI = true
			if len(series.Data) < 150 {
				t.Fatalf("RSI plot should retain the visible candle range, got %d points", len(series.Data))
			}
			minValue := math.Inf(1)
			maxValue := math.Inf(-1)
			for _, point := range series.Data {
				minValue = min(minValue, point.Value)
				maxValue = max(maxValue, point.Value)
				if point.Value < 0 || point.Value > 100 {
					t.Fatalf("RSI value out of oscillator bounds: %+v", point)
				}
			}
			if maxValue-minValue < 5 {
				t.Fatalf("RSI plot should vary visibly, min=%f max=%f", minValue, maxValue)
			}
		}
		if series.Key == "Cycler colors" && len(series.Data) > 0 {
			foundCycler = true
		}
	}
	if !foundRSI {
		t.Fatalf("missing RSI plot: %+v", resp.Result.Series)
	}
	if !foundCycler {
		t.Fatalf("missing cycler plot: %+v", resp.Result.Series)
	}
	if !foundExtendedReference {
		t.Fatalf("missing viewport-extended hline/fill reference output: %+v", resp.Result.Series)
	}
}

func TestCompileLineBreakPlotDoesNotBridgeNaGaps(t *testing.T) {
	source := `//@version=5
indicator("Line break")
x = close > 100 ? close : na
plot(x, style=plot.style_linebr, linewidth=3, color=color.red, title="Break Plot")`
	candles := sampleCandles(12)
	for index := range candles {
		if index >= 4 && index <= 7 {
			candles[index].Close = 95
		} else {
			candles[index].Close = 105 + float64(index)
		}
	}
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "linebr",
		SourceCode: source,
		Candles:    candles,
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	segments := []IndicatorSeries{}
	for _, series := range resp.Result.Series {
		if strings.HasPrefix(series.Key, "Break Plot:") {
			segments = append(segments, series)
		}
	}
	if len(segments) != 2 {
		t.Fatalf("expected two linebr segments, got %d: %+v", len(segments), resp.Result.Series)
	}
	for _, series := range segments {
		if series.StatusLineVisible == nil || *series.StatusLineVisible {
			t.Fatalf("linebr helper segments should stay out of status line: %+v", series)
		}
		if series.ExtendToVisibleRange != nil && *series.ExtendToVisibleRange {
			t.Fatalf("linebr helper segments must not be viewport-extended: %+v", series)
		}
		for index := 1; index < len(series.Data); index++ {
			step := series.Data[index].Time - series.Data[index-1].Time
			if step > 900 {
				t.Fatalf("linebr segment bridged a gap: key=%s step=%d data=%+v", series.Key, step, series.Data)
			}
		}
	}
}

func TestCompilePivotFunctionsEmitOnlyOnConfirmationBar(t *testing.T) {
	candles := make([]Candle, 9)
	highs := []float64{1, 2, 5, 3, 2, 4, 6, 3, 2}
	lows := []float64{0, -1, -3, -1, 0, -2, -1, -1, 0}
	for index := range candles {
		candles[index] = Candle{
			Time:   int64(index + 1),
			Open:   (highs[index] + lows[index]) / 2,
			High:   highs[index],
			Low:    lows[index],
			Close:  (highs[index] + lows[index]) / 2,
			Volume: 1,
		}
	}
	resp := Compile(context.Background(), CompileRequest{
		ScriptID: "pivot",
		SourceCode: `//@version=6
indicator("Swing pivots", overlay=true)
ph = ta.pivothigh(high, 2, 2)
pl = ta.pivotlow(low, 2, 2)
plot(ph, title="PH")
plot(pl, title="PL")`,
		Candles: candles,
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.Result.Series) != 2 {
		t.Fatalf("series = %+v, want PH and PL", resp.Result.Series)
	}
	if got := resp.Result.Series[0].Data; len(got) != 2 || got[0].Time != 5 || got[0].Value != 5 || got[1].Time != 9 || got[1].Value != 6 {
		t.Fatalf("unexpected pivot high points: %+v", got)
	}
	if got := resp.Result.Series[1].Data; len(got) != 2 || got[0].Time != 5 || got[0].Value != -3 || got[1].Time != 8 || got[1].Value != -2 {
		t.Fatalf("unexpected pivot low points: %+v", got)
	}
}

func TestExtractInputsIncludesHLCC4SwingSource(t *testing.T) {
	inputs := ExtractInputs(`//@version=6
indicator("Swing")
source = input.source(hlcc4, "Source")`)
	if len(inputs) != 1 || inputs[0].Kind != "source" {
		t.Fatalf("unexpected source input: %+v", inputs)
	}
	if len(inputs[0].Options) < 8 {
		t.Fatalf("expected HLCC4 source option set: %+v", inputs[0].Options)
	}
	found := false
	for _, option := range inputs[0].Options {
		if option == "hlcc4" {
			found = true
		}
	}
	if !found {
		t.Fatalf("HLCC4 missing from options: %+v", inputs[0].Options)
	}
}

func TestCompileMultiMovingAverageFunctionBody(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "multi-ma",
		SourceCode: multiMovingAverageSource,
		Candles:    sampleCandles(260),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if resp.Meta.ShortTitle != "10 in 1 MAs" {
		t.Fatalf("short title = %q, want 10 in 1 MAs", resp.Meta.ShortTitle)
	}
	if len(resp.Result.Series) != 1 {
		t.Fatalf("series count = %d, want 1: %+v", len(resp.Result.Series), resp.Result.Series)
	}
	series := resp.Result.Series[0]
	if series.Key != "MA 1" {
		t.Fatalf("series key = %q, want MA 1", series.Key)
	}
	if len(series.Data) == 0 {
		t.Fatalf("MA 1 should have data")
	}
	last := series.Data[len(series.Data)-1]
	if !usable(last.Value) {
		t.Fatalf("last MA 1 value should be usable, got %+v", last)
	}
	if series.Color != "#f44336" {
		t.Fatalf("series color = %q, want Pine red", series.Color)
	}
}

func TestCompileADRObjectRuntime(t *testing.T) {
	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "adr",
		SourceCode: adrSource,
		Candles:    sampleIntradayCandles(18),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.UnsupportedFeatures) > 0 {
		t.Fatalf("unexpected unsupported features: %+v", resp.UnsupportedFeatures)
	}
	hasLine := false
	hasFill := false
	for _, series := range resp.Result.Series {
		if series.Type == "line" {
			hasLine = true
		}
		if series.Type == "baselineFill" {
			hasFill = true
		}
	}
	if !hasLine || !hasFill {
		t.Fatalf("expected ADR line and zone series, got %+v", resp.Result.Series)
	}
	if len(resp.Result.Labels) == 0 {
		t.Fatalf("expected ADR labels")
	}
	if resp.Result.Dashboard == nil || len(resp.Result.Dashboard.Rows) < 4 {
		t.Fatalf("expected ADR dashboard, got %+v", resp.Result.Dashboard)
	}
}

func TestRequestSecurityLaggedSMABootstrapsFromPartialDailyHistory(t *testing.T) {
	source := `//@version=5
indicator("Daily ADR Warmup")
adr = request.security(syminfo.tickerid, "D", ta.sma(high - low, 10)[1], lookahead=barmerge.lookahead_off)
plot(adr, title="ADR")`

	resp := Compile(context.Background(), CompileRequest{
		ScriptID:   "security-warmup",
		SourceCode: source,
		Candles:    sampleIntradayCandles(4),
	})
	if len(resp.Errors) > 0 {
		t.Fatalf("compile errors: %+v", resp.Errors)
	}
	if len(resp.Result.Series) == 0 || len(resp.Result.Series[0].Data) == 0 {
		t.Fatalf("expected bootstrapped ADR plot, got %+v", resp.Result.Series)
	}
	last := resp.Result.Series[0].Data[len(resp.Result.Series[0].Data)-1]
	if !usable(last.Value) || last.Value <= 0 {
		t.Fatalf("expected usable bootstrapped ADR value, got %+v", last)
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

func TestHandlerCompileAppliesReplayCutoffBeforeSavedSourceExecution(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	source := `//@version=5
indicator("Replay-safe source")
plot(close)`
	candles := []Candle{
		{Time: 60, Close: 1},
		{Time: 120, Close: 2},
		{Time: 180, Close: 99},
	}
	body := `{"scriptId":"replay-source","sourceCode":` + quoteJSON(source) + `,"replayCutoff":120,"candles":` + candlesJSON(candles) + `}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pine-runtime/compile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("compile route: %v", err)
	}
	var decoded CompileResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK || len(decoded.Errors) != 0 || len(decoded.Result.Series) != 1 {
		t.Fatalf("replay compile response: status=%d body=%+v", resp.StatusCode, decoded)
	}
	points := decoded.Result.Series[0].Data
	if len(points) != 2 || points[len(points)-1].Time != 120 || points[len(points)-1].Value != 2 {
		t.Fatalf("future candle reached saved-source execution: %+v", points)
	}
}

func TestHandlerCompileRebindsSharedSavedScriptResultToEachInstance(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	makeRequest := func(scriptID string) CompileResponse {
		body := `{"scriptId":` + quoteJSON(scriptID) + `,"sourceCode":` + quoteJSON(vsaSource) + `,"candles":` + candlesJSON(sampleCandles(80)) + `}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/pine-runtime/compile", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("compile route for %s: %v", scriptID, err)
		}
		if resp.StatusCode != fiber.StatusOK {
			t.Fatalf("status for %s = %d", scriptID, resp.StatusCode)
		}
		var decoded CompileResponse
		if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
			t.Fatalf("decode %s: %v", scriptID, err)
		}
		return decoded
	}
	first := makeRequest("saved-by-user-a")
	second := makeRequest("saved-by-user-b")
	if first.Result.ID != "saved-by-user-a" || second.Result.ID != "saved-by-user-b" {
		t.Fatalf("shared compile result IDs were not rebound: first=%q second=%q", first.Result.ID, second.Result.ID)
	}
	if len(first.Result.Series) == 0 || len(second.Result.Series) == 0 {
		t.Fatal("saved scripts should retain compiled series on cache hits")
	}
}

func TestCompilerFailsClosedForUnsupportedPineFeatures(t *testing.T) {
	for name, source := range map[string]string{
		"strategy": `//@version=5
strategy("Orders")
strategy.entry("L", strategy.long)`,
		"visual": `//@version=5
indicator("Shapes")
plotshape(close > open)`,
		"multi-symbol": `//@version=5
indicator("Other symbol")
plot(request.security("NASDAQ:AAPL", "D", close))`,
	} {
		t.Run(name, func(t *testing.T) {
			response := Compile(context.Background(), CompileRequest{SourceCode: source, Candles: sampleCandles(20)})
			if len(response.Errors) == 0 || len(response.UnsupportedFeatures) == 0 {
				t.Fatalf("unsupported source compiled silently: %+v", response)
			}
		})
	}
}

func TestAlertConditionIsReportedWithoutBlockingHistoricalPlots(t *testing.T) {
	response := Compile(context.Background(), CompileRequest{
		SourceCode: `//@version=5
indicator("Alerted line")
plot(close)
alertcondition(close > open, "Up", "Up bar")`,
		Candles: sampleCandles(20),
	})
	if len(response.Errors) != 0 || len(response.Result.Series) != 1 {
		t.Fatalf("historical plot was blocked: %+v", response)
	}
	if len(response.UnsupportedFeatures) != 1 || response.UnsupportedFeatures[0] != "alert event delivery" {
		t.Fatalf("unsupported alerts = %+v", response.UnsupportedFeatures)
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
