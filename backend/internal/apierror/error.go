// Package apierror defines transport-neutral errors handled by the central HTTP layer.
package apierror

type Error struct {
	status  int
	code    string
	message string
	details any
}

func New(status int, code, message string) *Error {
	return &Error{status: status, code: code, message: message}
}

func NewWithDetails(status int, code, message string, details any) *Error {
	return &Error{status: status, code: code, message: message, details: details}
}

func (e *Error) Error() string     { return e.message }
func (e *Error) HTTPStatus() int   { return e.status }
func (e *Error) ErrorCode() string { return e.code }
func (e *Error) ErrorDetails() any { return e.details }
