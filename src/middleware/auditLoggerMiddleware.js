// Metodă de tip Factory pentru monitorizarea log-urilor pentru manageri
function createAuditLoggerMiddleware(auditLogger) {
  return (req, _res, next) => {
    // Atașez la request un auditLogger preconfigurat
    req.auditLogger = auditLogger.createRequestLogger(req);
    // continui execuția pe server
    next();
  };
}

module.exports = createAuditLoggerMiddleware;
