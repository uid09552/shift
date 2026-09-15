import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/core/url_input.dart';

void main() {
  Uri? parsed(String input) => parseBaseUrl(input).uri;
  UrlProblem? problem(String input) => parseBaseUrl(input).problem;

  group('accepts', () {
    test('a bare IPv4 address, defaulting to https', () {
      expect(parsed('192.168.0.10').toString(), 'https://192.168.0.10');
    });

    test('an explicit scheme and port', () {
      expect(parsed('http://10.0.0.5:8080').toString(), 'http://10.0.0.5:8080');
      expect(parsed('https://iem.example.com:8443').toString(),
          'https://iem.example.com:8443');
    });

    test('a host name, a single label and an IPv6 literal', () {
      expect(parsed('iem.example.com').toString(), 'https://iem.example.com');
      expect(parsed('edge-device-1').toString(), 'https://edge-device-1');
      expect(parsed('[2001:db8::1]').toString(), 'https://[2001:db8::1]');
    });

    test('and normalises case, trailing slash, query and fragment', () {
      expect(parsed('  HTTPS://IEM.Example.COM/  ').toString(),
          'https://iem.example.com');
      expect(parsed('https://iem.example.com/portal/').toString(),
          'https://iem.example.com/portal');
      expect(parsed('https://iem.example.com/?a=1#top').toString(),
          'https://iem.example.com');
    });
  });

  group('rejects', () {
    test('an empty value', () {
      expect(problem('   '), UrlProblem.empty);
    });

    test('a scheme that is not http or https', () {
      expect(problem('ftp://192.168.0.10'), UrlProblem.unsupportedScheme);
      expect(problem('ssh://device'), UrlProblem.unsupportedScheme);
      expect(problem('javascript://x'), UrlProblem.unsupportedScheme);
    });

    test('an IP-looking host that is not an IP address', () {
      expect(problem('192.168.0'), UrlProblem.invalidHost);
      expect(problem('192.168.0.999'), UrlProblem.invalidHost);
      expect(problem('1.2.3.4.5'), UrlProblem.invalidHost);
    });

    test('a malformed host name', () {
      expect(problem('iem..example.com'), UrlProblem.invalidHost);
      expect(problem('-iem.example.com'), UrlProblem.invalidHost);
      expect(problem('iem_example.com'), UrlProblem.invalidHost);
      expect(problem('https://'), UrlProblem.invalidHost);
    });

    test('an out-of-range port', () {
      expect(problem('192.168.0.10:70000'), UrlProblem.invalidPort);
      expect(problem('192.168.0.10:0'), UrlProblem.invalidPort);
    });

    test('credentials embedded in the URL', () {
      expect(problem('https://admin:secret@192.168.0.10'), UrlProblem.malformed);
    });
  });

  group('isValidHost', () {
    test('separates addresses, names and typos', () {
      expect(isValidHost('192.168.0.10'), isTrue);
      expect(isValidHost('2001:db8::1'), isTrue);
      expect(isValidHost('device'), isTrue);
      expect(isValidHost('a' * 64), isFalse);
      expect(isValidHost(''), isFalse);
    });
  });
}
