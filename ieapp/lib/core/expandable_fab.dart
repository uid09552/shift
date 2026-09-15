import 'package:flutter/material.dart';

/// One choice offered by an [ExpandableFab].
class FabAction {
  const FabAction({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;
}

/// A `+` button that expands into labelled actions instead of doing one thing.
///
/// Used on the devices tab so that adding an onboarded device and onboarding a
/// new one sit together on the same button.
class ExpandableFab extends StatefulWidget {
  const ExpandableFab({required this.actions, required this.tooltip, super.key});

  final List<FabAction> actions;

  /// Tooltip of the collapsed button.
  final String tooltip;

  @override
  State<ExpandableFab> createState() => _ExpandableFabState();
}

class _ExpandableFabState extends State<ExpandableFab> {
  static const _duration = Duration(milliseconds: 180);

  bool _open = false;

  void _toggle() => setState(() => _open = !_open);

  void _select(FabAction action) {
    setState(() => _open = false);
    action.onPressed();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        AnimatedSize(
          duration: _duration,
          alignment: Alignment.bottomRight,
          child: _open
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: widget.actions
                      .map(
                        (action) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _ActionRow(
                            action: action,
                            onPressed: () => _select(action),
                          ),
                        ),
                      )
                      .toList(),
                )
              : const SizedBox(width: 0, height: 0),
        ),
        FloatingActionButton(
          tooltip: widget.tooltip,
          onPressed: _toggle,
          child: AnimatedRotation(
            turns: _open ? 0.125 : 0,
            duration: _duration,
            child: const Icon(Icons.add),
          ),
        ),
      ],
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.action, required this.onPressed});

  final FabAction action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Card(
          margin: EdgeInsets.zero,
          color: theme.colorScheme.surfaceContainerHigh,
          child: InkWell(
            onTap: onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(action.label, style: theme.textTheme.labelLarge),
            ),
          ),
        ),
        const SizedBox(width: 12),
        FloatingActionButton.small(
          heroTag: null,
          tooltip: action.label,
          onPressed: onPressed,
          child: Icon(action.icon),
        ),
      ],
    );
  }
}
