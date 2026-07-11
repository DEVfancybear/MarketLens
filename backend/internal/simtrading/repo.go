package simtrading

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	ListAccounts(context.Context, string) ([]Account, error)
	CreateAccount(context.Context, string, AccountWrite) (Account, error)
	UpdateAccount(context.Context, string, string, AccountWrite) (Account, error)
	DeleteAccount(context.Context, string, string) error
	ResetAccount(context.Context, string, string) (Account, error)
	ListPositions(context.Context, string, string, string) ([]Position, error)
	UpsertPosition(context.Context, string, string, PositionWrite) (Position, error)
	Analytics(context.Context, string, string) (Analytics, error)
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

var _ Store = (*Repo)(nil)

const accountColumns = `a.id, a.name, a.starting_equity,
a.starting_equity + COALESCE((SELECT sum(p.realized_pnl) FROM sim_positions p WHERE p.account_id=a.id), 0),
a.currency, a.created_at, a.updated_at`

func (r *Repo) ListAccounts(ctx context.Context, userID string) ([]Account, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `SELECT `+accountColumns+` FROM sim_accounts a WHERE a.user_id=$1 ORDER BY a.updated_at DESC, a.id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Account{}
	for rows.Next() {
		item, e := scanAccount(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repo) CreateAccount(ctx context.Context, userID string, in AccountWrite) (Account, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Account{}, err
	}
	in, err = normalizeAccount(in)
	if err != nil {
		return Account{}, err
	}
	return scanAccount(r.pool.QueryRow(ctx, `INSERT INTO sim_accounts(user_id,name,starting_equity,currency) VALUES($1,$2,$3,$4)
RETURNING id,name,starting_equity,starting_equity,currency,created_at,updated_at`, uid, in.Name, in.StartingEquity, in.Currency))
}

func (r *Repo) UpdateAccount(ctx context.Context, userID, accountID string, in AccountWrite) (Account, error) {
	uid, aid, err := IDs(userID, accountID)
	if err != nil {
		return Account{}, err
	}
	in, err = normalizeAccount(in)
	if err != nil {
		return Account{}, err
	}
	item, err := scanAccount(r.pool.QueryRow(ctx, `UPDATE sim_accounts a SET name=$3,starting_equity=$4,currency=$5 WHERE a.user_id=$1 AND a.id=$2
RETURNING a.id,a.name,a.starting_equity,a.starting_equity+COALESCE((SELECT sum(p.realized_pnl) FROM sim_positions p WHERE p.account_id=a.id),0),a.currency,a.created_at,a.updated_at`, uid, aid, in.Name, in.StartingEquity, in.Currency))
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) DeleteAccount(ctx context.Context, userID, accountID string) error {
	uid, aid, err := IDs(userID, accountID)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM sim_accounts WHERE user_id=$1 AND id=$2`, uid, aid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) ResetAccount(ctx context.Context, userID, accountID string) (Account, error) {
	uid, aid, err := IDs(userID, accountID)
	if err != nil {
		return Account{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `DELETE FROM sim_positions p USING sim_accounts a WHERE p.account_id=a.id AND a.user_id=$1 AND a.id=$2`, uid, aid)
	if err != nil {
		return Account{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE sim_accounts SET updated_at=now() WHERE user_id=$1 AND id=$2`, uid, aid); err != nil {
		return Account{}, err
	}
	item, err := scanAccount(tx.QueryRow(ctx, `SELECT id,name,starting_equity,starting_equity,currency,created_at,updated_at FROM sim_accounts WHERE user_id=$1 AND id=$2`, uid, aid))
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Account{}, err
	}
	return item, nil
}

const positionColumns = `p.id,p.client_id,p.symbol,p.side,p.type,p.status,p.entry,p.quantity,p.remaining,p.stop_loss,p.take_profit,p.risk_pct,p.risk_amount,p.realized_pnl,p.unrealized_pnl,p.fills,p.notes,p.open_time,p.close_time,p.created_at,p.updated_at`

func (r *Repo) ListPositions(ctx context.Context, userID, accountID, status string) ([]Position, error) {
	uid, aid, err := IDs(userID, accountID)
	if err != nil {
		return nil, err
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if status != "" && status != "pending" && status != "open" && status != "closed" && status != "cancelled" {
		return nil, fmt.Errorf("%w: invalid status", ErrBadRequest)
	}
	rows, err := r.pool.Query(ctx, `SELECT `+positionColumns+` FROM sim_positions p JOIN sim_accounts a ON a.id=p.account_id WHERE a.user_id=$1 AND a.id=$2 AND ($3::text='' OR p.status::text=$3) ORDER BY p.updated_at DESC,p.id`, uid, aid, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Position{}
	for rows.Next() {
		item, e := scanPosition(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repo) UpsertPosition(ctx context.Context, userID, accountID string, in PositionWrite) (Position, error) {
	uid, aid, err := IDs(userID, accountID)
	if err != nil {
		return Position{}, err
	}
	in, err = normalizePosition(in)
	if err != nil {
		return Position{}, err
	}
	item, err := scanPosition(r.pool.QueryRow(ctx, `INSERT INTO sim_positions AS p(account_id,client_id,symbol,side,type,status,entry,quantity,remaining,stop_loss,take_profit,risk_pct,risk_amount,realized_pnl,unrealized_pnl,fills,notes,open_time,close_time)
SELECT a.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20 FROM sim_accounts a WHERE a.user_id=$1 AND a.id=$2
ON CONFLICT(account_id,client_id) DO UPDATE SET symbol=EXCLUDED.symbol,side=EXCLUDED.side,type=EXCLUDED.type,status=EXCLUDED.status,entry=EXCLUDED.entry,quantity=EXCLUDED.quantity,remaining=EXCLUDED.remaining,stop_loss=EXCLUDED.stop_loss,take_profit=EXCLUDED.take_profit,risk_pct=EXCLUDED.risk_pct,risk_amount=EXCLUDED.risk_amount,realized_pnl=EXCLUDED.realized_pnl,unrealized_pnl=EXCLUDED.unrealized_pnl,fills=EXCLUDED.fills,notes=EXCLUDED.notes,open_time=EXCLUDED.open_time,close_time=EXCLUDED.close_time,updated_at=now()
RETURNING `+positionColumns, uid, aid, in.ClientID, in.Symbol, in.Side, in.Type, in.Status, in.Entry, in.Quantity, in.Remaining, in.StopLoss, in.TakeProfit, in.RiskPct, in.RiskAmount, in.RealizedPnL, in.UnrealizedPnL, in.Fills, in.Notes, in.OpenTime, in.CloseTime))
	if errors.Is(err, pgx.ErrNoRows) {
		return Position{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) Analytics(ctx context.Context, userID, accountID string) (Analytics, error) {
	accounts, err := r.ListAccounts(ctx, userID)
	if err != nil {
		return Analytics{}, err
	}
	var account *Account
	for i := range accounts {
		if accounts[i].ID == accountID {
			account = &accounts[i]
			break
		}
	}
	if account == nil {
		return Analytics{}, ErrNotFound
	}
	positions, err := r.ListPositions(ctx, userID, accountID, "closed")
	if err != nil {
		return Analytics{}, err
	}
	sort.Slice(positions, func(i, j int) bool {
		if positions[i].CloseTime == nil {
			return false
		}
		if positions[j].CloseTime == nil {
			return true
		}
		return positions[i].CloseTime.Before(*positions[j].CloseTime)
	})
	return computeAnalytics(*account, positions), nil
}

func computeAnalytics(account Account, trades []Position) Analytics {
	buckets := []DistributionBucket{{Label: "≤ -2R"}, {Label: "-2..-1R"}, {Label: "-1..0R"}, {Label: "0..1R"}, {Label: "1..2R"}, {Label: "2..3R"}, {Label: "≥ 3R"}}
	report := Analytics{Equity: []EquityPoint{}, Monthly: []MonthlyStat{}, Distribution: buckets}
	s := &report.Summary
	s.TotalTrades = len(trades)
	running, peak := account.StartingEquity, account.StartingEquity
	winStreak, lossStreak := 0, 0
	months := map[string]*MonthlyStat{}
	for _, t := range trades {
		if t.CloseTime == nil {
			continue
		}
		p := t.RealizedPnL
		s.NetPnL += p
		if p > 0 {
			s.Wins++
			s.GrossProfit += p
			s.LargestWin = math.Max(s.LargestWin, p)
			winStreak++
			lossStreak = 0
			s.LongestWinStreak = max(s.LongestWinStreak, winStreak)
		} else if p < 0 {
			s.Losses++
			s.GrossLoss += -p
			s.LargestLoss = math.Min(s.LargestLoss, p)
			lossStreak++
			winStreak = 0
			s.LongestLossStreak = max(s.LongestLossStreak, lossStreak)
		} else {
			s.Breakeven++
			winStreak = 0
			lossStreak = 0
		}
		rr := 0.0
		if t.RiskAmount > 0 {
			rr = p / t.RiskAmount
		}
		s.AvgRR += rr
		idx := 6
		if rr <= -2 {
			idx = 0
		} else if rr <= -1 {
			idx = 1
		} else if rr < 0 {
			idx = 2
		} else if rr < 1 {
			idx = 3
		} else if rr < 2 {
			idx = 4
		} else if rr < 3 {
			idx = 5
		}
		report.Distribution[idx].Count++
		report.Distribution[idx].PnL += p
		running += p
		peak = math.Max(peak, running)
		dd := running - peak
		ddPct := 0.0
		if peak > 0 {
			ddPct = dd / peak * 100
		}
		s.MaxDrawdown = math.Min(s.MaxDrawdown, dd)
		s.MaxDrawdownPct = math.Min(s.MaxDrawdownPct, ddPct)
		close := *t.CloseTime
		report.Equity = append(report.Equity, EquityPoint{Time: close.UnixMilli(), Equity: running, Drawdown: dd})
		key := close.Format("2006-01")
		m := months[key]
		if m == nil {
			m = &MonthlyStat{Month: key}
			months[key] = m
		}
		m.PnL += p
		m.Trades++
		if p > 0 {
			m.WinRate++
		}
	}
	if s.TotalTrades > 0 {
		s.WinRate = float64(s.Wins) / float64(s.TotalTrades) * 100
		s.AvgRR /= float64(s.TotalTrades)
		s.AvgWin = zeroDiv(s.GrossProfit, s.Wins)
		s.AvgLoss = zeroDiv(s.GrossLoss, s.Losses)
		s.Expectancy = (float64(s.Wins)*s.AvgWin - float64(s.Losses)*s.AvgLoss) / float64(s.TotalTrades)
	}
	if s.GrossLoss > 0 {
		s.ProfitFactor = s.GrossProfit / s.GrossLoss
	} else if s.GrossProfit > 0 {
		s.ProfitFactor = math.MaxFloat64
	}
	keys := make([]string, 0, len(months))
	for k := range months {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		m := months[k]
		m.WinRate = m.WinRate / float64(m.Trades) * 100
		report.Monthly = append(report.Monthly, *m)
	}
	return report
}
func zeroDiv(v float64, n int) float64 {
	if n == 0 {
		return 0
	}
	return v / float64(n)
}

type rowScanner interface{ Scan(...any) error }

func scanAccount(row rowScanner) (Account, error) {
	var a Account
	var id pgtype.UUID
	err := row.Scan(&id, &a.Name, &a.StartingEquity, &a.Equity, &a.Currency, &a.CreatedAt, &a.UpdatedAt)
	a.ID = uuidString(id)
	return a, err
}
func scanPosition(row rowScanner) (Position, error) {
	var p Position
	var id pgtype.UUID
	var raw json.RawMessage
	err := row.Scan(&id, &p.ClientID, &p.Symbol, &p.Side, &p.Type, &p.Status, &p.Entry, &p.Quantity, &p.Remaining, &p.StopLoss, &p.TakeProfit, &p.RiskPct, &p.RiskAmount, &p.RealizedPnL, &p.UnrealizedPnL, &raw, &p.Notes, &p.OpenTime, &p.CloseTime, &p.CreatedAt, &p.UpdatedAt)
	if err == nil {
		err = json.Unmarshal(raw, &p.Fills)
	}
	if p.Fills == nil {
		p.Fills = []Fill{}
	}
	p.ID = uuidString(id)
	return p, err
}
func parseUUID(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(s)); err != nil {
		return id, fmt.Errorf("%w: invalid id", ErrBadRequest)
	}
	return id, nil
}
func IDs(userID, accountID string) (pgtype.UUID, pgtype.UUID, error) {
	u, e := parseUUID(userID)
	if e != nil {
		return u, pgtype.UUID{}, e
	}
	a, e := parseUUID(accountID)
	return u, a, e
}
func uuidString(id pgtype.UUID) string {
	v, e := id.Value()
	if e != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
