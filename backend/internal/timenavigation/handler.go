package timenavigation

import "github.com/gofiber/fiber/v3"

type resolveRequest struct {
	Shortcut   string `json:"shortcut"`
	AnchorTime int64  `json:"anchorTime"`
}

func RegisterRoutes(router fiber.Router, exchangeTimeZones ...string) {
	group := router.Group("/chart/time-navigation")
	group.Get("/shortcuts", func(c fiber.Ctx) error {
		return c.JSON(Catalog(exchangeTimeZones...))
	})
	group.Post("/resolve", func(c fiber.Ctx) error {
		var request resolveRequest
		if err := c.Bind().Body(&request); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid JSON body")
		}
		resolution, err := Resolve(request.Shortcut, request.AnchorTime)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}
		return c.JSON(resolution)
	})
}
