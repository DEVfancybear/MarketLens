package replay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/marketlens/backend/internal/db/gen"
)

type tradingDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type ledgerRuntime struct {
	db        tradingDB
	sessionID pgtype.UUID
}

type ledgerOrder struct {
	ID, TrackID                  pgtype.UUID
	ClientID, Side, Type, Status string
	Quantity, Filled             float64
	Limit, Stop, TP, SL          *float64
	Submitted                    time.Time
}

type ledgerPosition struct {
	ID, TrackID                        pgtype.UUID
	Symbol                             string
	Net, Average, Realized, Unrealized float64
	SL, TP                             *float64
}

func insertReplayAccount(ctx context.Context, db tradingDB, sessionID pgtype.UUID, trading *PreparedTrading) error {
	if trading == nil {
		return nil
	}
	_, err := db.Exec(ctx, `INSERT INTO replay_accounts
    (session_id, base_currency, starting_equity, balance, equity, commission_model)
    VALUES ($1,$2,$3,$3,$3,$4)`, sessionID, trading.BaseCurrency, trading.StartingEquity, trading.Commission)
	return err
}

func loadTradingSnapshot(ctx context.Context, db tradingDB, sessionID pgtype.UUID) (*TradingSnapshot, error) {
	var account ReplayAccount
	err := db.QueryRow(ctx, `SELECT base_currency, starting_equity::float8, balance::float8, equity::float8
    FROM replay_accounts WHERE session_id=$1`, sessionID).Scan(
		&account.BaseCurrency, &account.StartingEquity, &account.Balance, &account.Equity)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := &TradingSnapshot{Account: account, Orders: []ReplayOrder{}, Fills: []ReplayFill{}, Positions: []ReplayPosition{}}
	rows, err := db.Query(ctx, `SELECT id, track_id, client_order_id, side::text, order_type::text, status::text,
    quantity::float8, filled_quantity::float8, limit_price::float8, stop_price::float8,
    take_profit::float8, stop_loss::float8, submitted_at
    FROM replay_orders WHERE session_id=$1 ORDER BY submitted_at,id`, sessionID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, trackID pgtype.UUID
		var item ReplayOrder
		if err := rows.Scan(&id, &trackID, &item.ClientOrderID, &item.Side, &item.OrderType, &item.Status,
			&item.Quantity, &item.FilledQuantity, &item.LimitPrice, &item.StopPrice, &item.TakeProfit, &item.StopLoss, &item.SubmittedAt); err != nil {
			rows.Close()
			return nil, err
		}
		item.ID, item.TrackID = uuidString(id), uuidString(trackID)
		out.Orders = append(out.Orders, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = db.Query(ctx, `SELECT id, order_id, track_id, dataset_seq, simulated_at,
    price::float8, quantity::float8, commission::float8
    FROM replay_fills WHERE session_id=$1 ORDER BY simulated_at,id`, sessionID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, orderID, trackID pgtype.UUID
		var item ReplayFill
		if err := rows.Scan(&id, &orderID, &trackID, &item.DatasetSeq, &item.SimulatedAt, &item.Price, &item.Quantity, &item.Commission); err != nil {
			rows.Close()
			return nil, err
		}
		item.ID, item.OrderID, item.TrackID = uuidString(id), uuidString(orderID), uuidString(trackID)
		out.Fills = append(out.Fills, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	rows, err = db.Query(ctx, `SELECT id, track_id, symbol, net_quantity::float8, average_price::float8,
    realized_pnl::float8, unrealized_pnl::float8, stop_loss::float8, take_profit::float8
    FROM replay_positions WHERE session_id=$1 ORDER BY symbol,id`, sessionID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, trackID pgtype.UUID
		var item ReplayPosition
		if err := rows.Scan(&id, &trackID, &item.Symbol, &item.NetQuantity, &item.AveragePrice, &item.RealizedPnL, &item.UnrealizedPnL, &item.StopLoss, &item.TakeProfit); err != nil {
			rows.Close()
			return nil, err
		}
		item.ID, item.TrackID = uuidString(id), uuidString(trackID)
		out.Positions = append(out.Positions, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	return out, nil
}

func (l *ledgerRuntime) enabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := l.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM replay_accounts WHERE session_id=$1)`, l.sessionID).Scan(&enabled)
	return enabled, err
}
func (l *ledgerRuntime) hasFills(ctx context.Context) (bool, error) {
	var found bool
	err := l.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM replay_fills WHERE session_id=$1)`, l.sessionID).Scan(&found)
	return found, err
}
func (l *ledgerRuntime) reset(ctx context.Context, at time.Time) ([]eventDraft, error) {
	_, err := l.db.Exec(ctx, `DELETE FROM replay_orders WHERE session_id=$1`, l.sessionID)
	if err != nil {
		return nil, err
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_accounts SET balance=starting_equity,equity=starting_equity WHERE session_id=$1`, l.sessionID)
	if err != nil {
		return nil, err
	}
	return []eventDraft{{typ: "trading.reset", payload: map[string]any{"simulatedAt": at}}}, nil
}

func (l *ledgerRuntime) place(ctx context.Context, track *gen.ListReplayTracksForSessionForUpdateRow, session *gen.ReplaySession, bar gen.ReplayDatasetBar, payload json.RawMessage) ([]eventDraft, error) {
	var body struct {
		ClientOrderID string   `json:"clientOrderId"`
		TrackID       string   `json:"trackId"`
		Side          string   `json:"side"`
		OrderType     string   `json:"orderType"`
		Quantity      float64  `json:"quantity"`
		LimitPrice    *float64 `json:"limitPrice"`
		StopPrice     *float64 `json:"stopPrice"`
		TakeProfit    *float64 `json:"takeProfit"`
		StopLoss      *float64 `json:"stopLoss"`
	}
	if err := json.Unmarshal(normalizedPayload(payload), &body); err != nil {
		return nil, fmt.Errorf("%w: invalid place_order payload", ErrBadRequest)
	}
	body.ClientOrderID = strings.TrimSpace(body.ClientOrderID)
	body.Side = strings.ToLower(strings.TrimSpace(body.Side))
	body.OrderType = strings.ToLower(strings.TrimSpace(body.OrderType))
	if body.Side == "long" {
		body.Side = "buy"
	}
	if body.Side == "short" {
		body.Side = "sell"
	}
	if body.ClientOrderID == "" || len(body.ClientOrderID) > 200 || (body.Side != "buy" && body.Side != "sell") || body.Quantity <= 0 || !finite(body.Quantity) {
		return nil, fmt.Errorf("%w: invalid replay order", ErrBadRequest)
	}
	if body.OrderType == "" {
		body.OrderType = "market"
	}
	if body.OrderType != "market" && body.OrderType != "limit" && body.OrderType != "stop" && body.OrderType != "stop_limit" {
		return nil, fmt.Errorf("%w: unsupported order type", ErrBadRequest)
	}
	if body.OrderType == "limit" && (!validPrice(body.LimitPrice)) {
		return nil, fmt.Errorf("%w: limitPrice is required", ErrBadRequest)
	}
	if body.OrderType == "stop" && (!validPrice(body.StopPrice)) {
		return nil, fmt.Errorf("%w: stopPrice is required", ErrBadRequest)
	}
	if body.OrderType == "stop_limit" && (!validPrice(body.StopPrice) || !validPrice(body.LimitPrice)) {
		return nil, fmt.Errorf("%w: stopPrice and limitPrice are required", ErrBadRequest)
	}
	closeValue, _ := bar.Close.Float64Value()
	entryPrice := closeValue.Float64
	if body.OrderType == "limit" || body.OrderType == "stop_limit" {
		entryPrice = *body.LimitPrice
	}
	if body.OrderType == "stop" {
		entryPrice = *body.StopPrice
	}
	if !validBracket(body.Side, entryPrice, body.StopLoss, body.TakeProfit) {
		return nil, fmt.Errorf("%w: stop loss/take profit are on the wrong side of entry", ErrBadRequest)
	}
	trackID := track.ID
	if body.TrackID != "" && body.TrackID != uuidString(track.ID) {
		return nil, fmt.Errorf("%w: order track does not belong to the session", ErrBadRequest)
	}
	var orderID pgtype.UUID
	err := l.db.QueryRow(ctx, `INSERT INTO replay_orders(session_id,track_id,client_order_id,side,order_type,status,quantity,limit_price,stop_price,take_profit,stop_loss,submitted_at,updated_at_sim)
    VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$11) RETURNING id`, l.sessionID, trackID, body.ClientOrderID, body.Side, body.OrderType, body.Quantity, body.LimitPrice, body.StopPrice, body.TakeProfit, body.StopLoss, session.SimulatedTime.Time).Scan(&orderID)
	if err != nil {
		return nil, err
	}
	drafts := []eventDraft{{typ: "order.created", payload: map[string]any{"orderId": uuidString(orderID), "clientOrderId": body.ClientOrderID, "trackId": uuidString(trackID)}}}
	if body.OrderType == "market" {
		filled, err := l.fillOrder(ctx, orderID, trackID, track.Symbol, body.Side, body.Quantity, closeValue.Float64, bar.Seq, session.SimulatedTime.Time, body.StopLoss, body.TakeProfit)
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, filled...)
	}
	return drafts, nil
}

func (l *ledgerRuntime) cancel(ctx context.Context, payload json.RawMessage, at time.Time) ([]eventDraft, error) {
	var body struct {
		OrderID string `json:"orderId"`
	}
	if json.Unmarshal(normalizedPayload(payload), &body) != nil || body.OrderID == "" {
		return nil, fmt.Errorf("%w: orderId is required", ErrBadRequest)
	}
	tag, err := l.db.Exec(ctx, `UPDATE replay_orders SET status='cancelled',updated_at_sim=$3 WHERE id=$1 AND session_id=$2 AND status IN('pending','partially_filled')`, body.OrderID, l.sessionID, at)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() != 1 {
		return nil, ErrNotFound
	}
	return []eventDraft{{typ: "order.cancelled", payload: map[string]any{"orderId": body.OrderID}}}, nil
}

func (l *ledgerRuntime) updateBracket(ctx context.Context, payload json.RawMessage, at time.Time) ([]eventDraft, error) {
	var body struct {
		OrderID    string   `json:"orderId"`
		StopLoss   *float64 `json:"stopLoss"`
		TakeProfit *float64 `json:"takeProfit"`
	}
	if json.Unmarshal(normalizedPayload(payload), &body) != nil || body.OrderID == "" {
		return nil, fmt.Errorf("%w: orderId is required", ErrBadRequest)
	}
	if (body.StopLoss != nil && !validPrice(body.StopLoss)) || (body.TakeProfit != nil && !validPrice(body.TakeProfit)) {
		return nil, fmt.Errorf("%w: bracket prices must be positive", ErrBadRequest)
	}
	var side string
	var entryPrice *float64
	err := l.db.QueryRow(ctx, `SELECT CASE WHEN p.net_quantity>0 THEN 'buy' WHEN p.net_quantity<0 THEN 'sell' ELSE o.side::text END,
      COALESCE(NULLIF(p.average_price,0),o.limit_price,o.stop_price)::float8
    FROM replay_orders o LEFT JOIN replay_positions p ON p.session_id=o.session_id AND p.track_id=o.track_id
    WHERE o.id=$1 AND o.session_id=$2`, body.OrderID, l.sessionID).Scan(&side, &entryPrice)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if entryPrice != nil && !validBracket(side, *entryPrice, body.StopLoss, body.TakeProfit) {
		return nil, fmt.Errorf("%w: stop loss/take profit are on the wrong side of entry", ErrBadRequest)
	}
	tag, err := l.db.Exec(ctx, `UPDATE replay_orders SET stop_loss=$3,take_profit=$4,updated_at_sim=$5 WHERE id=$1 AND session_id=$2 AND status<>'cancelled'`, body.OrderID, l.sessionID, body.StopLoss, body.TakeProfit, at)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() != 1 {
		return nil, ErrNotFound
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_positions p SET stop_loss=$3,take_profit=$4,updated_at_sim=$5 FROM replay_orders o WHERE o.id=$1 AND p.session_id=$2 AND p.track_id=o.track_id AND p.net_quantity<>0`, body.OrderID, l.sessionID, body.StopLoss, body.TakeProfit, at)
	if err != nil {
		return nil, err
	}
	return []eventDraft{{typ: "order.updated", payload: map[string]any{"orderId": body.OrderID, "stopLoss": body.StopLoss, "takeProfit": body.TakeProfit}}}, nil
}

func (l *ledgerRuntime) closePosition(ctx context.Context, track *gen.ListReplayTracksForSessionForUpdateRow, session *gen.ReplaySession, bar gen.ReplayDatasetBar, payload json.RawMessage) ([]eventDraft, error) {
	var body struct {
		PositionID string   `json:"positionId"`
		TrackID    string   `json:"trackId"`
		Fraction   float64  `json:"fraction"`
		Quantity   *float64 `json:"quantity"`
	}
	if json.Unmarshal(normalizedPayload(payload), &body) != nil || body.PositionID == "" {
		return nil, fmt.Errorf("%w: positionId is required", ErrBadRequest)
	}
	var p ledgerPosition
	err := l.db.QueryRow(ctx, `SELECT id,track_id,symbol,net_quantity::float8,average_price::float8,realized_pnl::float8,unrealized_pnl::float8,stop_loss::float8,take_profit::float8 FROM replay_positions WHERE id=$1 AND session_id=$2 FOR UPDATE`, body.PositionID, l.sessionID).Scan(&p.ID, &p.TrackID, &p.Symbol, &p.Net, &p.Average, &p.Realized, &p.Unrealized, &p.SL, &p.TP)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if p.TrackID != track.ID || (body.TrackID != "" && body.TrackID != uuidString(track.ID)) {
		return nil, fmt.Errorf("%w: position track does not belong to the selected chart", ErrBadRequest)
	}
	if math.Abs(p.Net) < 1e-12 {
		return nil, fmt.Errorf("%w: position is already flat", ErrBadRequest)
	}
	qty := math.Abs(p.Net)
	if body.Quantity != nil {
		qty = math.Min(qty, *body.Quantity)
	} else if body.Fraction > 0 && body.Fraction <= 1 {
		qty *= body.Fraction
	}
	if qty <= 0 {
		return nil, fmt.Errorf("%w: invalid close quantity", ErrBadRequest)
	}
	side := "sell"
	if p.Net < 0 {
		side = "buy"
	}
	clientID := fmt.Sprintf("close:%s:%d", body.PositionID, session.Version)
	var orderID pgtype.UUID
	err = l.db.QueryRow(ctx, `INSERT INTO replay_orders(session_id,track_id,client_order_id,side,order_type,status,quantity,submitted_at,updated_at_sim) VALUES($1,$2,$3,$4,'market','pending',$5,$6,$6) RETURNING id`, l.sessionID, p.TrackID, clientID, side, qty, session.SimulatedTime.Time).Scan(&orderID)
	if err != nil {
		return nil, err
	}
	closeValue, _ := bar.Close.Float64Value()
	drafts := []eventDraft{{typ: "order.created", payload: map[string]any{"orderId": uuidString(orderID), "clientOrderId": clientID, "trackId": uuidString(p.TrackID)}}}
	filled, err := l.fillOrder(ctx, orderID, p.TrackID, p.Symbol, side, qty, closeValue.Float64, bar.Seq, session.SimulatedTime.Time, nil, nil)
	return append(drafts, filled...), err
}

func (l *ledgerRuntime) processRows(ctx context.Context, track *gen.ListReplayTracksForSessionForUpdateRow, rows []gen.ReplayDatasetBar) ([]eventDraft, error) {
	active, err := l.hasActiveMarketState(ctx, track.ID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, nil
	}
	var drafts []eventDraft
	for _, bar := range rows {
		brackets, err := l.processBrackets(ctx, track, bar)
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, brackets...)
		orders, err := l.pendingOrders(ctx, track.ID)
		if err != nil {
			return nil, err
		}
		for _, order := range orders {
			price, ok := triggerPrice(order, bar)
			if !ok {
				continue
			}
			filled, err := l.fillOrder(ctx, order.ID, order.TrackID, track.Symbol, order.Side, order.Quantity-order.Filled, price, bar.Seq, bar.OpenTime.Time, order.SL, order.TP)
			if err != nil {
				return nil, err
			}
			drafts = append(drafts, filled...)
		}
		if err := l.markToMarket(ctx, track.ID, bar); err != nil {
			return nil, err
		}
	}
	return drafts, nil
}

func (l *ledgerRuntime) hasActiveMarketState(ctx context.Context, trackID pgtype.UUID) (bool, error) {
	var active bool
	err := l.db.QueryRow(ctx, `SELECT
    EXISTS(SELECT 1 FROM replay_orders WHERE session_id=$1 AND track_id=$2 AND status IN('pending','partially_filled')) OR
    EXISTS(SELECT 1 FROM replay_positions WHERE session_id=$1 AND track_id=$2 AND net_quantity<>0)`,
		l.sessionID, trackID).Scan(&active)
	return active, err
}

func (l *ledgerRuntime) pendingOrders(ctx context.Context, trackID pgtype.UUID) ([]ledgerOrder, error) {
	rows, err := l.db.Query(ctx, `SELECT id,track_id,client_order_id,side::text,order_type::text,status::text,quantity::float8,filled_quantity::float8,limit_price::float8,stop_price::float8,take_profit::float8,stop_loss::float8,submitted_at FROM replay_orders WHERE session_id=$1 AND track_id=$2 AND status IN('pending','partially_filled') ORDER BY submitted_at,client_order_id`, l.sessionID, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ledgerOrder
	for rows.Next() {
		var o ledgerOrder
		if err := rows.Scan(&o.ID, &o.TrackID, &o.ClientID, &o.Side, &o.Type, &o.Status, &o.Quantity, &o.Filled, &o.Limit, &o.Stop, &o.TP, &o.SL, &o.Submitted); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func triggerPrice(o ledgerOrder, bar gen.ReplayDatasetBar) (float64, bool) {
	op, _ := bar.Open.Float64Value()
	hi, _ := bar.High.Float64Value()
	lo, _ := bar.Low.Float64Value()
	switch o.Type {
	case "limit":
		if o.Side == "buy" && o.Limit != nil && lo.Float64 <= *o.Limit {
			return math.Min(op.Float64, *o.Limit), true
		}
		if o.Side == "sell" && o.Limit != nil && hi.Float64 >= *o.Limit {
			return math.Max(op.Float64, *o.Limit), true
		}
	case "stop":
		if o.Side == "buy" && o.Stop != nil && hi.Float64 >= *o.Stop {
			return math.Max(op.Float64, *o.Stop), true
		}
		if o.Side == "sell" && o.Stop != nil && lo.Float64 <= *o.Stop {
			return math.Min(op.Float64, *o.Stop), true
		}
	case "stop_limit":
		if o.Stop != nil && o.Limit != nil {
			if o.Side == "buy" && hi.Float64 >= *o.Stop && lo.Float64 <= *o.Limit {
				return *o.Limit, true
			}
			if o.Side == "sell" && lo.Float64 <= *o.Stop && hi.Float64 >= *o.Limit {
				return *o.Limit, true
			}
		}
	}
	return 0, false
}

func (l *ledgerRuntime) processBrackets(ctx context.Context, track *gen.ListReplayTracksForSessionForUpdateRow, bar gen.ReplayDatasetBar) ([]eventDraft, error) {
	rows, err := l.db.Query(ctx, `SELECT id,track_id,symbol,net_quantity::float8,average_price::float8,realized_pnl::float8,unrealized_pnl::float8,stop_loss::float8,take_profit::float8 FROM replay_positions WHERE session_id=$1 AND track_id=$2 AND net_quantity<>0 ORDER BY id`, l.sessionID, track.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var positions []ledgerPosition
	for rows.Next() {
		var p ledgerPosition
		if err := rows.Scan(&p.ID, &p.TrackID, &p.Symbol, &p.Net, &p.Average, &p.Realized, &p.Unrealized, &p.SL, &p.TP); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var drafts []eventDraft
	for _, p := range positions {
		price, kind, ok := bracketPrice(p, bar)
		if !ok {
			continue
		}
		side := "sell"
		if p.Net < 0 {
			side = "buy"
		}
		clientID := fmt.Sprintf("bracket:%s:%d", uuidString(p.ID), bar.Seq)
		var orderID pgtype.UUID
		err := l.db.QueryRow(ctx, `INSERT INTO replay_orders(session_id,track_id,client_order_id,side,order_type,status,quantity,submitted_at,updated_at_sim) VALUES($1,$2,$3,$4,'market','pending',$5,$6,$6) ON CONFLICT(session_id,client_order_id) DO NOTHING RETURNING id`, l.sessionID, p.TrackID, clientID, side, math.Abs(p.Net), bar.OpenTime.Time).Scan(&orderID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, eventDraft{typ: "order.created", payload: map[string]any{"orderId": uuidString(orderID), "reason": kind}})
		filled, err := l.fillOrder(ctx, orderID, p.TrackID, p.Symbol, side, math.Abs(p.Net), price, bar.Seq, bar.OpenTime.Time, nil, nil)
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, filled...)
	}
	return drafts, nil
}

func bracketPrice(p ledgerPosition, bar gen.ReplayDatasetBar) (float64, string, bool) {
	op, _ := bar.Open.Float64Value()
	hi, _ := bar.High.Float64Value()
	lo, _ := bar.Low.Float64Value()
	cl, _ := bar.Close.Float64Value()
	bull := cl.Float64 >= op.Float64
	if p.Net > 0 {
		sl := p.SL != nil && lo.Float64 <= *p.SL
		tp := p.TP != nil && hi.Float64 >= *p.TP
		if sl && tp {
			if bull {
				return gapOrLevel(op.Float64, *p.SL, false), "stop_loss", true
			}
			return gapOrLevel(op.Float64, *p.TP, true), "take_profit", true
		}
		if sl {
			return gapOrLevel(op.Float64, *p.SL, false), "stop_loss", true
		}
		if tp {
			return gapOrLevel(op.Float64, *p.TP, true), "take_profit", true
		}
	}
	if p.Net < 0 {
		sl := p.SL != nil && hi.Float64 >= *p.SL
		tp := p.TP != nil && lo.Float64 <= *p.TP
		if sl && tp {
			if bull {
				return gapOrLevel(op.Float64, *p.TP, false), "take_profit", true
			}
			return gapOrLevel(op.Float64, *p.SL, true), "stop_loss", true
		}
		if sl {
			return gapOrLevel(op.Float64, *p.SL, true), "stop_loss", true
		}
		if tp {
			return gapOrLevel(op.Float64, *p.TP, false), "take_profit", true
		}
	}
	return 0, "", false
}
func gapOrLevel(open, level float64, up bool) float64 {
	if up && open > level {
		return open
	}
	if !up && open < level {
		return open
	}
	return level
}

func (l *ledgerRuntime) fillOrder(ctx context.Context, orderID, trackID pgtype.UUID, symbol, side string, qty, price float64, seq int64, at time.Time, sl, tp *float64) ([]eventDraft, error) {
	if qty <= 0 || price <= 0 {
		return nil, fmt.Errorf("%w: invalid fill", ErrBadRequest)
	}
	var fillID pgtype.UUID
	commission, err := l.commission(ctx, qty)
	if err != nil {
		return nil, err
	}
	err = l.db.QueryRow(ctx, `INSERT INTO replay_fills(session_id,order_id,track_id,dataset_seq,simulated_at,price,quantity,commission) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(order_id,dataset_seq) DO NOTHING RETURNING id`, l.sessionID, orderID, trackID, seq, at, price, qty, commission).Scan(&fillID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_orders SET filled_quantity=quantity,status='filled',updated_at_sim=$3 WHERE id=$1 AND session_id=$2`, orderID, l.sessionID, at)
	if err != nil {
		return nil, err
	}
	position, realized, err := l.applyPositionFill(ctx, trackID, symbol, side, qty, price, at, sl, tp)
	if err != nil {
		return nil, err
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_accounts SET balance=balance+$2-$3 WHERE session_id=$1`, l.sessionID, realized, commission)
	if err != nil {
		return nil, err
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_accounts a SET equity=a.balance+COALESCE((
    SELECT sum(unrealized_pnl) FROM replay_positions p WHERE p.session_id=a.session_id
  ),0) WHERE a.session_id=$1`, l.sessionID)
	if err != nil {
		return nil, err
	}
	return []eventDraft{
		{typ: "order.filled", payload: map[string]any{"orderId": uuidString(orderID), "price": price, "quantity": qty}},
		{typ: "fill.created", payload: map[string]any{"fillId": uuidString(fillID), "orderId": uuidString(orderID), "trackId": uuidString(trackID), "datasetSeq": seq, "price": price, "quantity": qty, "commission": commission}},
		{typ: "position.updated", payload: position},
		{typ: "account.updated", payload: map[string]any{"realizedDelta": realized}},
	}, nil
}

func (l *ledgerRuntime) commission(ctx context.Context, quantity float64) (float64, error) {
	var raw []byte
	if err := l.db.QueryRow(ctx, `SELECT commission_model FROM replay_accounts WHERE session_id=$1`, l.sessionID).Scan(&raw); err != nil {
		return 0, err
	}
	return commissionFromModel(raw, quantity)
}

func commissionFromModel(raw []byte, quantity float64) (float64, error) {
	var model struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	}
	if err := json.Unmarshal(raw, &model); err != nil || model.Kind == "" {
		return 0, nil
	}
	value, err := strconv.ParseFloat(model.Value, 64)
	if err != nil || value < 0 || !finite(value) {
		return 0, fmt.Errorf("%w: invalid commission model", ErrBadRequest)
	}
	if model.Kind != "per_unit" {
		return 0, fmt.Errorf("%w: unsupported commission model", ErrBadRequest)
	}
	return value * quantity, nil
}

func (l *ledgerRuntime) applyPositionFill(ctx context.Context, trackID pgtype.UUID, symbol, side string, qty, price float64, at time.Time, sl, tp *float64) (ReplayPosition, float64, error) {
	var p ledgerPosition
	err := l.db.QueryRow(ctx, `SELECT id,track_id,symbol,net_quantity::float8,average_price::float8,realized_pnl::float8,unrealized_pnl::float8,stop_loss::float8,take_profit::float8 FROM replay_positions WHERE session_id=$1 AND track_id=$2 AND symbol=$3 FOR UPDATE`, l.sessionID, trackID, symbol).Scan(&p.ID, &p.TrackID, &p.Symbol, &p.Net, &p.Average, &p.Realized, &p.Unrealized, &p.SL, &p.TP)
	if errors.Is(err, pgx.ErrNoRows) {
		err = l.db.QueryRow(ctx, `INSERT INTO replay_positions(session_id,track_id,symbol,updated_at_sim) VALUES($1,$2,$3,$4) RETURNING id`, l.sessionID, trackID, symbol, at).Scan(&p.ID)
		p.TrackID = trackID
		p.Symbol = symbol
	} else if err != nil {
		return ReplayPosition{}, 0, err
	}
	signed := qty
	if side == "sell" {
		signed = -qty
	}
	old := p.Net
	next := old + signed
	realized := 0.0
	if old == 0 || sameSign(old, signed) {
		total := math.Abs(old) + qty
		p.Average = (p.Average*math.Abs(old) + price*qty) / total
		if sl != nil {
			p.SL = sl
		}
		if tp != nil {
			p.TP = tp
		}
	} else {
		closed := math.Min(math.Abs(old), qty)
		realized = (price - p.Average) * closed
		if old < 0 {
			realized = -realized
		}
		p.Realized += realized
		if math.Abs(next) < 1e-12 {
			next = 0
			p.Average = 0
			p.SL = nil
			p.TP = nil
		} else if !sameSign(old, next) {
			p.Average = price
			p.SL = sl
			p.TP = tp
		}
	}
	p.Net = next
	p.Unrealized = 0
	_, err = l.db.Exec(ctx, `UPDATE replay_positions SET net_quantity=$2,average_price=$3,realized_pnl=$4,unrealized_pnl=0,stop_loss=$5,take_profit=$6,updated_at_sim=$7 WHERE id=$1`, p.ID, p.Net, p.Average, p.Realized, p.SL, p.TP, at)
	if err != nil {
		return ReplayPosition{}, 0, err
	}
	return replayPosition(p), realized, nil
}

func (l *ledgerRuntime) markToMarket(ctx context.Context, trackID pgtype.UUID, bar gen.ReplayDatasetBar) error {
	closeValue, _ := bar.Close.Float64Value()
	_, err := l.db.Exec(ctx, `UPDATE replay_positions SET unrealized_pnl=(($3-average_price)*net_quantity),updated_at_sim=$4 WHERE session_id=$1 AND track_id=$2 AND net_quantity<>0`, l.sessionID, trackID, closeValue.Float64, bar.OpenTime.Time)
	if err != nil {
		return err
	}
	_, err = l.db.Exec(ctx, `UPDATE replay_accounts a SET equity=a.balance+COALESCE((SELECT sum(unrealized_pnl) FROM replay_positions p WHERE p.session_id=a.session_id),0) WHERE a.session_id=$1`, l.sessionID)
	return err
}

func replayPosition(p ledgerPosition) ReplayPosition {
	return ReplayPosition{ID: uuidString(p.ID), TrackID: uuidString(p.TrackID), Symbol: p.Symbol, NetQuantity: p.Net, AveragePrice: p.Average, RealizedPnL: p.Realized, UnrealizedPnL: p.Unrealized, StopLoss: p.SL, TakeProfit: p.TP}
}
func validPrice(value *float64) bool { return value != nil && finite(*value) && *value > 0 }
func validBracket(side string, entry float64, stopLoss, takeProfit *float64) bool {
	if stopLoss != nil && !validPrice(stopLoss) || takeProfit != nil && !validPrice(takeProfit) {
		return false
	}
	if side == "buy" {
		return (stopLoss == nil || *stopLoss < entry) && (takeProfit == nil || *takeProfit > entry)
	}
	return (stopLoss == nil || *stopLoss > entry) && (takeProfit == nil || *takeProfit < entry)
}
func sameSign(a, b float64) bool { return (a > 0 && b > 0) || (a < 0 && b < 0) }

func buildReplayReport(ctx context.Context, db tradingDB, sessionID pgtype.UUID) (ReplayReport, error) {
	trading, err := loadTradingSnapshot(ctx, db, sessionID)
	if err != nil {
		return ReplayReport{}, err
	}
	if trading == nil {
		return ReplayReport{}, ErrNotFound
	}
	report := ReplayReport{SessionID: uuidString(sessionID), GeneratedAt: time.Now().UTC(), Account: trading.Account, Fills: trading.Fills, NetPnL: trading.Account.Balance - trading.Account.StartingEquity}
	rows, err := db.Query(ctx, `SELECT f.track_id,o.side::text,f.price::float8,f.quantity::float8,f.commission::float8
    FROM replay_fills f JOIN replay_orders o ON o.id=f.order_id
    WHERE f.session_id=$1 ORDER BY f.simulated_at,f.dataset_seq,o.client_order_id`, sessionID)
	if err != nil {
		return ReplayReport{}, err
	}
	states := map[string]reportPositionState{}
	for rows.Next() {
		var trackID pgtype.UUID
		var side string
		var price, quantity, commission float64
		if err := rows.Scan(&trackID, &side, &price, &quantity, &commission); err != nil {
			rows.Close()
			return ReplayReport{}, err
		}
		state := states[uuidString(trackID)]
		var closed bool
		var pnl float64
		state, closed, pnl = applyReportFill(state, side, price, quantity, commission)
		states[uuidString(trackID)] = state
		if closed {
			report.ClosedTrades++
			if pnl > 0 {
				report.WinningTrades++
			} else {
				report.LosingTrades++
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ReplayReport{}, err
	}
	rows.Close()
	_ = db.QueryRow(ctx, `SELECT COALESCE(max(drawdown),0)::float8 FROM replay_equity_points WHERE session_id=$1`, sessionID).Scan(&report.MaxDrawdown)
	return report, nil
}

type reportPositionState struct{ Net, Average, EntryCommission float64 }

func applyReportFill(state reportPositionState, side string, price, quantity, commission float64) (reportPositionState, bool, float64) {
	signed := quantity
	if side == "sell" {
		signed = -quantity
	}
	if state.Net == 0 || sameSign(state.Net, signed) {
		total := math.Abs(state.Net) + quantity
		state.Average = (state.Average*math.Abs(state.Net) + price*quantity) / total
		state.Net += signed
		state.EntryCommission += commission
		return state, false, 0
	}
	closedQuantity := math.Min(math.Abs(state.Net), quantity)
	entryCommission := state.EntryCommission * closedQuantity / math.Abs(state.Net)
	exitCommission := commission * closedQuantity / quantity
	pnl := (price - state.Average) * closedQuantity
	if state.Net < 0 {
		pnl = -pnl
	}
	pnl -= entryCommission + exitCommission
	state.EntryCommission -= entryCommission
	next := state.Net + signed
	if math.Abs(next) < 1e-12 {
		return reportPositionState{}, true, pnl
	}
	if !sameSign(state.Net, next) {
		state.Average = price
		state.EntryCommission = commission - exitCommission
	}
	state.Net = next
	return state, true, pnl
}
