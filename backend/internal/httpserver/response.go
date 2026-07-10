package httpserver

import "github.com/gofiber/fiber/v2"

// errorBody is the inner payload of the standard error envelope from API.md:
//
//	{ "error": { "code": "unauthorized", "message": "human readable detail" } }
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error errorBody `json:"error"`
}

// WriteError writes the standard error envelope with the given HTTP status.
// code is the stable machine-readable slug (e.g. "unauthorized"); message is
// the human-readable detail.
func WriteError(c *fiber.Ctx, status int, code, message string) error {
	return c.Status(status).JSON(errorResponse{Error: errorBody{Code: code, Message: message}})
}

// codeForStatus maps an HTTP status to the stable slug used in error.code.
func codeForStatus(status int) string {
	switch status {
	case fiber.StatusBadRequest:
		return "bad_request"
	case fiber.StatusUnauthorized:
		return "unauthorized"
	case fiber.StatusForbidden:
		return "forbidden"
	case fiber.StatusNotFound:
		return "not_found"
	case fiber.StatusConflict:
		return "conflict"
	case fiber.StatusTooManyRequests:
		return "rate_limited"
	default:
		if status >= 500 {
			return "internal"
		}
		return "error"
	}
}

// errorHandler is Fiber's central error handler. It normalizes any handler
// error (including *fiber.Error) into the standard error envelope so clients
// always see the same shape.
func errorHandler(c *fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	message := "internal server error"

	if fe, ok := err.(*fiber.Error); ok {
		status = fe.Code
		message = fe.Message
	}
	code := codeForStatus(status)
	if apiErr, ok := err.(interface {
		HTTPStatus() int
		ErrorCode() string
	}); ok {
		status = apiErr.HTTPStatus()
		code = apiErr.ErrorCode()
		message = err.Error()
	}

	return WriteError(c, status, code, message)
}
