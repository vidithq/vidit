"""The base of every business error the API answers with a typed ``{code, message}`` body."""


class CodedError(Exception):
    """A business error with a stable ``code`` and the HTTP status the API answers it with.

    ``main.coded_error_handler`` turns an uncaught one into the response. The attribute is
    ``status_code``, as on ``HTTPException``, so Sentry still captures a 5xx one.
    """

    code: str
    status_code: int
