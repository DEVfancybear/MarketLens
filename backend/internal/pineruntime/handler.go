package pineruntime

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	timeout       timeouter
	compileJobs   *runtimeJobGroup[CompileResponse]
	indicatorJobs *runtimeJobGroup[IndicatorRuntimeResponse]
}

type timeouter interface {
	WithTimeout(context.Context) (context.Context, context.CancelFunc)
}

type runtimeTimeout struct{}

func (runtimeTimeout) WithTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, defaultCompileTimeout)
}

func NewHandler() *Handler {
	timeout := runtimeTimeout{}
	return &Handler{
		timeout:       timeout,
		compileJobs:   newRuntimeJobGroup[CompileResponse](defaultRuntimeCacheEntries, timeout),
		indicatorJobs: newRuntimeJobGroup[IndicatorRuntimeResponse](defaultRuntimeCacheEntries, timeout),
	}
}

func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/pine-runtime")
	g.Post("/meta", h.meta)
	g.Post("/inputs", h.inputs)
	g.Post("/styles", h.styles)
	g.Post("/compile", h.compile)
	router.Post("/indicator-runtime/compute", h.computeIndicator)
}

func (h *Handler) meta(c *fiber.Ctx) error {
	var req MetaRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	meta := ExtractMeta(req.SourceCode)
	return c.JSON(MetaResponse{
		Name:       meta.Name,
		ShortTitle: meta.ShortTitle,
		Overlay:    meta.Overlay,
		Timeframe:  meta.Timeframe,
		Errors:     []RuntimeError{},
	})
}

func (h *Handler) inputs(c *fiber.Ctx) error {
	var req InputsRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	return c.JSON(InputsResponse{Inputs: ExtractInputs(req.SourceCode), Errors: []RuntimeError{}})
}

func (h *Handler) styles(c *fiber.Ctx) error {
	var req StylesRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	return c.JSON(StylesResponse{Styles: ExtractStyles(req.SourceCode), Errors: []RuntimeError{}})
}

func (h *Handler) compile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	ctx, cancel := h.timeout.WithTimeout(c.Context())
	defer cancel()

	key, err := compileRuntimeKey(req)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid runtime properties")
	}
	canonical := req
	canonical.ScriptID = ""
	response, err := h.compileJobs.Do(ctx, key, func(jobCtx context.Context) (CompileResponse, error) {
		response := Compile(jobCtx, canonical)
		return response, jobCtx.Err()
	})
	if err != nil {
		return c.Status(runtimeErrorStatus(err)).JSON(CompileResponse{
			Meta: ExtractMeta(req.SourceCode),
			Result: IndicatorResult{
				ID:     req.ScriptID,
				Series: []IndicatorSeries{},
			},
			Errors: []RuntimeError{{Message: err.Error()}},
		})
	}
	response.Result.ID = runtimeResultID(req.ScriptID, "custom")
	return c.JSON(response)
}

func (h *Handler) computeIndicator(c *fiber.Ctx) error {
	var req IndicatorRuntimeRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	ctx, cancel := h.timeout.WithTimeout(c.Context())
	defer cancel()

	key, err := indicatorRuntimeKey(req)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid runtime properties")
	}
	canonical := req
	canonical.IndicatorID = ""
	canonical.Config = runtimeConfigForKey(req.Config)
	response, err := h.indicatorJobs.Do(ctx, key, func(jobCtx context.Context) (IndicatorRuntimeResponse, error) {
		response := ComputeIndicatorRuntime(jobCtx, canonical)
		return response, jobCtx.Err()
	})
	if err != nil {
		return c.Status(runtimeErrorStatus(err)).JSON(IndicatorRuntimeResponse{
			Result:   IndicatorResult{ID: req.IndicatorID, Series: []IndicatorSeries{}},
			Errors:   []RuntimeError{{Message: err.Error()}},
			Warnings: []RuntimeError{},
		})
	}
	response.Result.ID = runtimeResultID(req.IndicatorID, "builtin")
	return c.JSON(response)
}

func runtimeResultID(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func runtimeErrorStatus(err error) int {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fiber.StatusRequestTimeout
	}
	if errors.Is(err, errRuntimeQueueFull) {
		return fiber.StatusServiceUnavailable
	}
	return fiber.StatusInternalServerError
}
