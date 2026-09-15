/// How the onboarding configuration is transferred to an Industrial Edge Device.
///
/// None of these paths are implemented yet: each needs the onboarding
/// configuration issued by the connected IEM, which needs the IEM API client.
enum OnboardingMethod { qrCode, usb, webAccess }
