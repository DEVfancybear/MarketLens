package pineruntime

import (
	"context"
	"encoding/json"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	timeout timeouter
}

type timeouter interface {
	WithTimeout(context.Context) (context.Context, context.CancelFunc)
}

type runtimeTimeout struct{}

func (runtimeTimeout) WithTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, defaultCompileTimeout)
}

func NewHandler() *Handler {
	return &Handler{timeout: runtimeTimeout{}}
}

func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/pine-runtime")
	g.Post("/meta", h.meta)
	g.Post("/inputs", h.inputs)
	g.Post("/styles", h.styles)
	g.Post("/compile", h.compile)
}

func (h *Handler) meta(c *fiber.Ctx) error {
	var req MetaRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	meta := ExtractMeta(req.SourceCode)
	return c.JSON(MetaResponse{
		Name:      meta.Name,
		Overlay:   meta.Overlay,
		Timeframe: meta.Timeframe,
		Errors:    []RuntimeError{},
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

	type result struct {
		resp CompileResponse
	}
	ch := make(chan result, 1)
	go func() {
		ch <- result{resp: Compile(ctx, req)}
	}()

	select {
	case <-ctx.Done():
		return c.Status(fiber.StatusRequestTimeout).JSON(CompileResponse{
			Meta: ExtractMeta(req.SourceCode),
			Result: IndicatorResult{
				ID:     req.ScriptID,
				Series: []IndicatorSeries{},
			},
			Errors: []RuntimeError{{Message: ctx.Err().Error()}},
		})
	case item := <-ch:
		return c.JSON(item.resp)
	}
}
