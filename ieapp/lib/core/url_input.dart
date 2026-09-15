/// Why a typed base URL was rejected.
enum UrlProblem {
  /// Nothing was entered.
  empty,

  /// A scheme other than http or https.
  unsupportedScheme,

  /// Not a usable IP address or host name.
  invalidHost,

  /// Port outside 1..65535.
  invalidPort,

  /// Not parseable as a URI at all.
  malformed,
}

/// Outcome of [parseBaseUrl]: either a normalised [uri] or a [problem].
class UrlParseResult {
  const UrlParseResult.success(Uri this.uri) : problem = null;
  const UrlParseResult.failure(UrlProblem this.problem) : uri = null;

  final Uri? uri;
  final UrlProblem? problem;

  bool get isValid => uri != null;
}

/// Parses what the user typed into the base URL of an IEM or an edge device.
///
/// Accepts a bare host or IP (`192.168.0.10`, `iem.example.com:8443`) and
/// defaults it to `https`, since edge systems are not reachable over plain
/// http in any sane setup. Only http and https are allowed — an edge base URL
/// is an HTTP endpoint, and accepting anything else would only push the failure
/// to the first request.
///
/// The result is normalised: lower-case scheme and host, no trailing slash, no
/// query or fragment.
UrlParseResult parseBaseUrl(String input) {
  final text = input.trim();
  if (text.isEmpty) return const UrlParseResult.failure(UrlProblem.empty);

  final schemeMatch = RegExp(r'^([A-Za-z][A-Za-z0-9+.-]*):\/\/').firstMatch(text);
  if (schemeMatch != null) {
    final scheme = schemeMatch.group(1)!.toLowerCase();
    if (scheme != 'http' && scheme != 'https') {
      return const UrlParseResult.failure(UrlProblem.unsupportedScheme);
    }
  } else if (text.contains('://')) {
    return const UrlParseResult.failure(UrlProblem.malformed);
  }

  final uri = Uri.tryParse(schemeMatch != null ? text : 'https://$text');
  if (uri == null) return const UrlParseResult.failure(UrlProblem.malformed);
  if (uri.userInfo.isNotEmpty) {
    // Credentials belong in the user name and password fields, not in the URL.
    return const UrlParseResult.failure(UrlProblem.malformed);
  }

  final host = uri.host;
  if (host.isEmpty || !isValidHost(host)) {
    return const UrlParseResult.failure(UrlProblem.invalidHost);
  }

  if (uri.hasPort && (uri.port < 1 || uri.port > 65535)) {
    return const UrlParseResult.failure(UrlProblem.invalidPort);
  }

  final path = uri.path.endsWith('/')
      ? uri.path.substring(0, uri.path.length - 1)
      : uri.path;

  return UrlParseResult.success(
    Uri(
      scheme: uri.scheme.toLowerCase(),
      host: host.toLowerCase(),
      port: uri.hasPort ? uri.port : null,
      path: path.isEmpty ? null : path,
    ),
  );
}

/// True for an IPv4 literal, an IPv6 literal, or a syntactically valid host name.
bool isValidHost(String host) {
  if (host.isEmpty || host.length > 253) return false;

  // `Uri` hands IPv6 literals back without their brackets.
  if (host.contains(':')) {
    try {
      Uri.parseIPv6Address(host);
      return true;
    } on FormatException {
      return false;
    }
  }

  if (RegExp(r'^[0-9.]+$').hasMatch(host)) {
    try {
      Uri.parseIPv4Address(host);
      return true;
    } on FormatException {
      // A dotted-decimal-looking host that is not an IP is a typo, not a name.
      return false;
    }
  }

  final labels = host.split('.');
  if (labels.any((label) => label.isEmpty)) return false;
  return labels.every(
    (label) =>
        label.length <= 63 &&
        RegExp(r'^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$').hasMatch(label),
  );
}
