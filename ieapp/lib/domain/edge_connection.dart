import 'package:flutter/foundation.dart';

/// A stored connection to an Industrial Edge system.
///
/// The same shape covers the single IEM connection and each Industrial Edge
/// Device (IED): a base URL, the user name used against it, and an optional
/// display name. The password is never part of this object — it lives in the
/// platform secure storage, keyed by [id]. See `data/credential_store.dart`.
@immutable
class EdgeConnection {
  const EdgeConnection({
    required this.id,
    required this.baseUrl,
    required this.username,
    required this.addedAt,
    this.displayName,
  });

  factory EdgeConnection.fromJson(Map<String, dynamic> json) => EdgeConnection(
    id: json['id'] as String,
    baseUrl: Uri.parse(json['baseUrl'] as String),
    username: json['username'] as String,
    displayName: json['displayName'] as String?,
    addedAt: DateTime.parse(json['addedAt'] as String),
  );

  final String id;
  final Uri baseUrl;
  final String username;
  final String? displayName;
  final DateTime addedAt;

  /// Host part of [baseUrl] — for edge devices this is normally the IP address.
  String get host => baseUrl.host;

  /// What the fleet list shows as the device name.
  String get name {
    final custom = displayName?.trim();
    return (custom == null || custom.isEmpty) ? host : custom;
  }

  EdgeConnection copyWith({
    Uri? baseUrl,
    String? username,
    String? displayName,
    bool clearDisplayName = false,
  }) => EdgeConnection(
    id: id,
    baseUrl: baseUrl ?? this.baseUrl,
    username: username ?? this.username,
    displayName: clearDisplayName ? null : (displayName ?? this.displayName),
    addedAt: addedAt,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'baseUrl': baseUrl.toString(),
    'username': username,
    if (displayName != null) 'displayName': displayName,
    'addedAt': addedAt.toIso8601String(),
  };

  @override
  bool operator ==(Object other) =>
      other is EdgeConnection &&
      other.id == id &&
      other.baseUrl == baseUrl &&
      other.username == username &&
      other.displayName == displayName &&
      other.addedAt == addedAt;

  @override
  int get hashCode => Object.hash(id, baseUrl, username, displayName, addedAt);
}
