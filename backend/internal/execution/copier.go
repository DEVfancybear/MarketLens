package execution

import (
	"context"
	"net/http"
	"strings"
)

const (
	CopyGroupActionPause     = "pause"
	CopyGroupActionResume    = "resume"
	CopyGroupActionReconcile = "reconcile"
	CopyGroupActionArchive   = "archive"
)

type CopyAllocation struct {
	Mode        string  `json:"mode"`
	Quantity    *string `json:"quantity,omitempty"`
	Unit        *string `json:"unit,omitempty"`
	Multiplier  *string `json:"multiplier,omitempty"`
	BasisPoints *uint32 `json:"basisPoints,omitempty"`
}

type BrokerMarginCap struct {
	Basis       string `json:"basis"`
	BasisPoints uint32 `json:"basisPoints"`
	Alert       bool   `json:"alert"`
}

type ContinuousCopyConfig struct {
	CopyMarketOrders         *bool   `json:"copyMarketOrders,omitempty"`
	CopyPendingOrders        *bool   `json:"copyPendingOrders,omitempty"`
	CopyStopLossTakeProfit   *bool   `json:"copyStopLossTakeProfit,omitempty"`
	CopyModifications        *bool   `json:"copyModifications,omitempty"`
	CopyPartialCloses        *bool   `json:"copyPartialCloses,omitempty"`
	SourceMagicFilter        *int64  `json:"sourceMagicFilter,omitempty"`
	SourceCommentPrefix      *string `json:"sourceCommentPrefix,omitempty"`
	MaxSlippagePoints        *uint32 `json:"maxSlippagePoints,omitempty"`
	StaleAfterMS             *uint64 `json:"staleAfterMs,omitempty"`
	ReconciliationIntervalMS *uint64 `json:"reconciliationIntervalMs,omitempty"`
}

type CopyProtectionConfig struct {
	BrokerMarginCap        *BrokerMarginCap `json:"brokerMarginCap,omitempty"`
	MaxDrawdownBasisPoints *uint32          `json:"maxDrawdownBasisPoints,omitempty"`
	TrailingStopPoints     *uint32          `json:"trailingStopPoints,omitempty"`
	TrailingStepPoints     *uint32          `json:"trailingStepPoints,omitempty"`
	TrailingStartPoints    *uint32          `json:"trailingStartPoints,omitempty"`
	BreakevenTriggerPoints *uint32          `json:"breakevenTriggerPoints,omitempty"`
	BreakevenOffsetPoints  *uint32          `json:"breakevenOffsetPoints,omitempty"`
}

type ContinuousCopyTargetConfig struct {
	Allocation    CopyAllocation        `json:"allocation"`
	MaxQuantity   *string               `json:"maxQuantity,omitempty"`
	ReverseTrade  bool                  `json:"reverseTrade"`
	SymbolMapping map[string]string     `json:"symbolMapping"`
	Protection    *CopyProtectionConfig `json:"protection"`
}

type CopyGroupWriteRequest struct {
	ExpectedRevision *uint64               `json:"expectedRevision,omitempty"`
	Name             string                `json:"name"`
	SourceAccountID  string                `json:"sourceAccountId"`
	Enabled          bool                  `json:"enabled"`
	Config           *ContinuousCopyConfig `json:"config"`
}

type CopyTargetWriteRequest struct {
	ExpectedRevision *uint64                    `json:"expectedRevision,omitempty"`
	AccountID        string                     `json:"accountId"`
	Enabled          bool                       `json:"enabled"`
	Config           ContinuousCopyTargetConfig `json:"config"`
}

type CopyGroupUpsertRequest struct {
	GroupID                string                   `json:"groupId,omitempty"`
	Group                  CopyGroupWriteRequest    `json:"group"`
	Targets                []CopyTargetWriteRequest `json:"targets"`
	AuthorizationToken     string                   `json:"-"`
	AuthorizationSessionID string                   `json:"-"`
}

type CopyGroupActionRequest struct {
	GroupID                string `json:"groupId"`
	ExpectedRevision       uint64 `json:"expectedRevision"`
	Action                 string `json:"action"`
	AuthorizationToken     string `json:"-"`
	AuthorizationSessionID string `json:"-"`
}

type CopyGroupDefinition struct {
	ID              string               `json:"id"`
	OwnerID         string               `json:"ownerId"`
	Name            string               `json:"name"`
	SourceAccountID string               `json:"sourceAccountId"`
	Enabled         bool                 `json:"enabled"`
	Revision        uint64               `json:"revision"`
	AppliedRevision uint64               `json:"appliedRevision"`
	RuntimeStatus   string               `json:"runtimeStatus"`
	Config          ContinuousCopyConfig `json:"config"`
	StatusMessage   *string              `json:"statusMessage"`
	UpdatedAtMS     uint64               `json:"updatedAtMs"`
}

type CopyTargetDefinition struct {
	GroupID         string                     `json:"groupId"`
	AccountID       string                     `json:"accountId"`
	Enabled         bool                       `json:"enabled"`
	Revision        uint64                     `json:"revision"`
	AppliedRevision uint64                     `json:"appliedRevision"`
	RuntimeStatus   string                     `json:"runtimeStatus"`
	Config          ContinuousCopyTargetConfig `json:"config"`
	StatusMessage   *string                    `json:"statusMessage"`
	UpdatedAtMS     uint64                     `json:"updatedAtMs"`
}

type CopyGroupView struct {
	Group            CopyGroupDefinition    `json:"group"`
	Targets          []CopyTargetDefinition `json:"targets"`
	PendingWork      uint64                 `json:"pendingWork"`
	UnresolvedErrors uint64                 `json:"unresolvedErrors"`
	ActiveLinks      uint64                 `json:"activeLinks"`
}

func (c *Client) ListCopyGroups(
	ctx context.Context,
	ownerID string,
	groupID string,
) ([]CopyGroupView, error) {
	endpoint := c.resolve("/v1/admin/copy-groups")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	if groupID != "" {
		query.Set("groupId", groupID)
	}
	endpoint.RawQuery = query.Encode()
	var groups []CopyGroupView
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &groups)
	return groups, err
}

func (c *Client) UpsertCopyGroup(
	ctx context.Context,
	ownerID string,
	request CopyGroupUpsertRequest,
) (CopyGroupView, error) {
	body := struct {
		OwnerID                string                   `json:"ownerId"`
		GroupID                string                   `json:"groupId,omitempty"`
		Group                  CopyGroupWriteRequest    `json:"group"`
		Targets                []CopyTargetWriteRequest `json:"targets"`
		AuthorizationToken     string                   `json:"authorizationToken,omitempty"`
		AuthorizationSessionID string                   `json:"authorizationSessionId,omitempty"`
	}{
		OwnerID:                ownerID,
		GroupID:                request.GroupID,
		Group:                  request.Group,
		Targets:                request.Targets,
		AuthorizationToken:     request.AuthorizationToken,
		AuthorizationSessionID: request.AuthorizationSessionID,
	}
	var group CopyGroupView
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/copy-groups"), body, &group)
	return group, err
}

func (c *Client) ApplyCopyGroupAction(
	ctx context.Context,
	ownerID string,
	request CopyGroupActionRequest,
) (CopyGroupView, error) {
	body := struct {
		OwnerID                string `json:"ownerId"`
		GroupID                string `json:"groupId"`
		ExpectedRevision       uint64 `json:"expectedRevision"`
		Action                 string `json:"action"`
		AuthorizationToken     string `json:"authorizationToken,omitempty"`
		AuthorizationSessionID string `json:"authorizationSessionId,omitempty"`
	}{
		OwnerID:                ownerID,
		GroupID:                request.GroupID,
		ExpectedRevision:       request.ExpectedRevision,
		Action:                 request.Action,
		AuthorizationToken:     request.AuthorizationToken,
		AuthorizationSessionID: request.AuthorizationSessionID,
	}
	var group CopyGroupView
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/copy-groups/actions"),
		body,
		&group,
	)
	return group, err
}

func validCopyGroupUpsert(request CopyGroupUpsertRequest) bool {
	if request.GroupID == "" {
		if request.Group.ExpectedRevision != nil {
			return false
		}
	} else if !validCopyGroupID(request.GroupID) ||
		request.Group.ExpectedRevision == nil || *request.Group.ExpectedRevision == 0 {
		return false
	}
	name := strings.TrimSpace(request.Group.Name)
	if name == "" || len(name) > 80 || !validPlainText(name) ||
		!validExecutionIdentifier(request.Group.SourceAccountID, 96) ||
		!validContinuousCopyConfig(request.Group.Config) ||
		len(request.Targets) == 0 || len(request.Targets) > 20 {
		return false
	}
	seen := make(map[string]struct{}, len(request.Targets))
	enabledTargets := 0
	for _, target := range request.Targets {
		if !validExecutionIdentifier(target.AccountID, 96) ||
			target.AccountID == request.Group.SourceAccountID ||
			!validContinuousCopyTargetConfig(target.Config) ||
			(target.ExpectedRevision != nil && *target.ExpectedRevision == 0) {
			return false
		}
		if _, exists := seen[target.AccountID]; exists {
			return false
		}
		seen[target.AccountID] = struct{}{}
		if target.Enabled {
			enabledTargets++
		}
	}
	return !request.Group.Enabled || enabledTargets > 0
}

func validContinuousCopyConfig(config *ContinuousCopyConfig) bool {
	// These fields are required by the browser contract. Requiring their wire
	// presence also keeps the approved JSON identical to the Rust gateway's
	// default-expanded authorization payload.
	if config == nil ||
		config.CopyMarketOrders == nil ||
		config.CopyPendingOrders == nil ||
		config.CopyStopLossTakeProfit == nil ||
		config.CopyModifications == nil ||
		config.CopyPartialCloses == nil ||
		config.MaxSlippagePoints == nil ||
		config.StaleAfterMS == nil ||
		config.ReconciliationIntervalMS == nil {
		return false
	}
	if *config.StaleAfterMS == 0 {
		return false
	}
	if *config.ReconciliationIntervalMS == 0 {
		return false
	}
	if config.SourceCommentPrefix != nil {
		prefix := strings.TrimSpace(*config.SourceCommentPrefix)
		if len(prefix) > 128 || !validPlainText(prefix) {
			return false
		}
	}
	return true
}

func validContinuousCopyTargetConfig(config ContinuousCopyTargetConfig) bool {
	if !validCopyAllocation(config.Allocation) ||
		(config.MaxQuantity != nil && !validPositiveDecimal(*config.MaxQuantity)) ||
		config.SymbolMapping == nil || !validCopyProtection(config.Protection) ||
		len(config.SymbolMapping) > 256 {
		return false
	}
	for canonical, venue := range config.SymbolMapping {
		if !validSymbol(canonical) || !validSymbol(venue) {
			return false
		}
	}
	return true
}

func validCopyAllocation(allocation CopyAllocation) bool {
	switch allocation.Mode {
	case "sameQuantity":
		return allocation.Quantity == nil && allocation.Unit == nil &&
			allocation.Multiplier == nil && allocation.BasisPoints == nil
	case "fixedQuantity":
		return allocation.Quantity != nil && validPositiveDecimal(*allocation.Quantity) &&
			allocation.Unit != nil && validQuantityUnit(*allocation.Unit) &&
			allocation.Multiplier == nil && allocation.BasisPoints == nil
	case "multiplier", "equityProportional":
		return allocation.Quantity == nil && allocation.Unit == nil &&
			allocation.Multiplier != nil && validPositiveDecimal(*allocation.Multiplier) &&
			allocation.BasisPoints == nil
	case "riskPercent":
		return allocation.Quantity == nil && allocation.Unit == nil &&
			allocation.Multiplier == nil && allocation.BasisPoints != nil &&
			*allocation.BasisPoints >= 1 && *allocation.BasisPoints <= 10_000
	default:
		return false
	}
}

func validCopyProtection(protection *CopyProtectionConfig) bool {
	if protection == nil ||
		protection.TrailingStopPoints == nil ||
		protection.TrailingStepPoints == nil ||
		protection.TrailingStartPoints == nil ||
		protection.BreakevenTriggerPoints == nil ||
		protection.BreakevenOffsetPoints == nil {
		return false
	}
	if protection.BrokerMarginCap != nil {
		cap := protection.BrokerMarginCap
		if (cap.Basis != "equity" && cap.Basis != "balance") ||
			cap.BasisPoints < 1 || cap.BasisPoints > 10_000 {
			return false
		}
	}
	if protection.MaxDrawdownBasisPoints != nil &&
		(*protection.MaxDrawdownBasisPoints < 1 || *protection.MaxDrawdownBasisPoints > 10_000) {
		return false
	}
	if protection.TrailingStopPoints != nil && *protection.TrailingStopPoints > 0 &&
		(protection.TrailingStepPoints == nil || *protection.TrailingStepPoints == 0) {
		return false
	}
	return true
}

func validCopyGroupAction(request CopyGroupActionRequest) bool {
	if !validCopyGroupID(request.GroupID) || request.ExpectedRevision == 0 {
		return false
	}
	switch request.Action {
	case CopyGroupActionPause, CopyGroupActionResume,
		CopyGroupActionReconcile, CopyGroupActionArchive:
		return true
	default:
		return false
	}
}

func validQuantityUnit(unit string) bool {
	switch unit {
	case "lots", "baseUnits", "contracts", "quoteNotional":
		return true
	default:
		return false
	}
}

func validPositiveDecimal(value string) bool {
	if value == "" || len(value) > 64 || strings.TrimSpace(value) != value {
		return false
	}
	if len(value) > 1 && value[0] == '0' && value[1] != '.' {
		// rust_decimal removes redundant leading zeroes when the gateway builds
		// the authorization payload, so accepting them here would make an
		// otherwise valid one-time token fail its exact JSONB comparison.
		return false
	}
	seenDigit := false
	seenNonZero := false
	seenPoint := false
	for index, character := range []byte(value) {
		if character >= '0' && character <= '9' {
			seenDigit = true
			seenNonZero = seenNonZero || character != '0'
			continue
		}
		if character == '.' && !seenPoint && index > 0 && index < len(value)-1 {
			seenPoint = true
			continue
		}
		return false
	}
	return seenDigit && seenNonZero
}

func validCopyGroupID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range []byte(value) {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') ||
				(character >= 'a' && character <= 'f') ||
				(character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}

func validPlainText(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}
