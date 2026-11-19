/** validate(zodSchema, 'body' | 'query' | 'params') - replaces the source with parsed data. */
module.exports =
  (schema, source = "body") =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    if (source === "query") {
      // req.query is a getter in newer Express versions; store parsed data separately
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
