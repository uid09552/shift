#!/usr/bin/env python3
"""
Bootstrap script for Ory Kratos and Hydra.
Creates OAuth2 client for APISIX gateway and configures OIDC plugin.
"""
import os
import sys
import json
import requests
from pathlib import Path

# Configuration
HYDRA_ADMIN_URL = os.environ.get("HYDRA_ADMIN_URL", "http://localhost:4445")
HYDRA_PUBLIC_URL = os.environ.get("HYDRA_PUBLIC_URL", "http://localhost:4444")
KRATOS_PUBLIC_URL = os.environ.get("KRATOS_PUBLIC_URL", "http://localhost:4433")
KRATOS_ADMIN_URL = os.environ.get("KRATOS_ADMIN_URL", "http://localhost:4434")
APISIX_ADMIN_URL = os.environ.get("APISIX_ADMIN_URL", "http://localhost:9180")
APISIX_API_KEY = os.environ.get("APISIX_API_KEY", "edd1c9f034335f136f87ad84b625c8f1")

# OAuth2 client configuration
CLIENT_NAME = os.environ.get("OAUTH2_CLIENT_NAME", "apisix-gateway")
REDIRECT_URI = os.environ.get("REDIRECT_URI", "http://localhost/callback")
POST_LOGOUT_URI = os.environ.get("POST_LOGOUT_URI", "http://localhost/")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "geheimgeheimgeheimgeheim12345678")

SCRIPT_DIR = Path(__file__).parent.absolute()
CREDENTIALS_FILE = SCRIPT_DIR / ".oauth2-credentials.json"
APISIX_STANDALONE_FILE = SCRIPT_DIR.parent / "gateway" / "apisix_conf" / "apisix-standalone.yaml"

def log_info(msg): print(f"\033[32m[INFO]\033[0m {msg}")
def log_warn(msg): print(f"\033[33m[WARN]\033[0m {msg}")
def log_error(msg): print(f"\033[31m[ERROR]\033[0m {msg}")

def check_hydra_health():
    """Check if Hydra is healthy."""
    log_info(f"Checking Hydra at {HYDRA_PUBLIC_URL}...")
    try:
        r = requests.get(f"{HYDRA_PUBLIC_URL}/.well-known/openid-configuration", timeout=10)
        if r.status_code == 200:
            log_info("Hydra is healthy")
            return True
    except Exception as e:
        log_error(f"Hydra not accessible: {e}")
    return False

def check_kratos_health():
    """Check if Kratos is healthy."""
    log_info(f"Checking Kratos at {KRATOS_ADMIN_URL}...")
    try:
        r = requests.get(f"{KRATOS_ADMIN_URL}/health/ready", timeout=10)
        if r.status_code == 200:
            log_info("Kratos is healthy")
            return True
    except Exception as e:
        log_error(f"Kratos not accessible: {e}")
    return False

def create_oauth2_client():
    """Create OAuth2 client for APISIX gateway."""
    log_info(f"Creating OAuth2 client '{CLIENT_NAME}'...")
    
    # Check if client already exists and delete it to get fresh credentials
    try:
        r = requests.get(
            f"{HYDRA_ADMIN_URL}/admin/clients",
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        if r.status_code == 200:
            clients = r.json()
            for client in clients:
                if client.get("client_name") == CLIENT_NAME:
                    client_id = client["client_id"]
                    log_info(f"OAuth2 client '{CLIENT_NAME}' already exists, recreating...")
                    # Delete existing client to get fresh secret
                    del_r = requests.delete(
                        f"{HYDRA_ADMIN_URL}/admin/clients/{client_id}",
                        headers={"Content-Type": "application/json"},
                        timeout=10
                    )
                    if del_r.status_code not in [200, 204, 404]:
                        log_warn(f"Could not delete existing client: {del_r.status_code}")
                    break
    except Exception as e:
        log_warn(f"Could not list clients: {e}")
    
    # Create new client
    payload = {
        "client_name": CLIENT_NAME,
        "redirect_uris": [REDIRECT_URI],
        "post_logout_redirect_uris": [POST_LOGOUT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code", "id_token", "token"],
        "scope": "openid offline_access profile email",
        "token_endpoint_auth_method": "client_secret_basic",
        "skip_consent": True
    }
    
    try:
        r = requests.post(
            f"{HYDRA_ADMIN_URL}/admin/clients",
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=10
        )
        if r.status_code in [200, 201]:
            data = r.json()
            client_id = data.get("client_id")
            client_secret = data.get("client_secret")
            log_info(f"OAuth2 client created: {client_id}")
            return client_id, client_secret
        else:
            log_error(f"Failed to create client: {r.status_code} - {r.text}")
    except Exception as e:
        log_error(f"Failed to create client: {e}")
    
    return None, None

def save_credentials(client_id, client_secret):
    """Save OAuth2 credentials to file."""
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "issuer_url": HYDRA_PUBLIC_URL,
        "redirect_uri": REDIRECT_URI,
        "post_logout_uri": POST_LOGOUT_URI
    }
    with open(CREDENTIALS_FILE, "w") as f:
        json.dump(data, f, indent=2)
    log_info(f"Credentials saved to {CREDENTIALS_FILE}")

def update_standalone_config(client_id, client_secret):
    """Update APISIX standalone config with OAuth2 credentials."""
    if not APISIX_STANDALONE_FILE.exists():
        log_warn(f"Standalone config file not found: {APISIX_STANDALONE_FILE}")
        return False
    
    log_info(f"Updating standalone config: {APISIX_STANDALONE_FILE}")
    
    try:
        content = APISIX_STANDALONE_FILE.read_text()
        # Replace template placeholders with actual credentials
        content = content.replace("${OAUTH2_CLIENT_ID}", client_id)
        content = content.replace("${OAUTH2_CLIENT_SECRET}", client_secret)
        
        # Write updated content
        APISIX_STANDALONE_FILE.write_text(content)
        log_info("Standalone config updated with OAuth2 credentials")
        return True
    except Exception as e:
        log_error(f"Failed to update standalone config: {e}")
        return False

def restore_standalone_config():
    """Restore APISIX standalone config with template placeholders."""
    if not APISIX_STANDALONE_FILE.exists():
        log_warn(f"Standalone config file not found: {APISIX_STANDALONE_FILE}")
        return
    
    try:
        # Read credentials to get client_id for restoration
        if CREDENTIALS_FILE.exists():
            with open(CREDENTIALS_FILE, "r") as f:
                creds = json.load(f)
                client_id = creds.get("client_id", "")
                client_secret = creds.get("client_secret", "")
        else:
            log_warn("No credentials file found, cannot restore placeholders")
            return
        
        content = APISIX_STANDALONE_FILE.read_text()
        # Replace actual credentials with template placeholders
        if client_id:
            content = content.replace(client_id, "${OAUTH2_CLIENT_ID}")
        if client_secret:
            content = content.replace(client_secret, "${OAUTH2_CLIENT_SECRET}")
        
        APISIX_STANDALONE_FILE.write_text(content)
        log_info("Standalone config restored with template placeholders")
    except Exception as e:
        log_warn(f"Failed to restore standalone config: {e}")

def configure_apisix(client_id, client_secret):
    """Configure APISIX gateway with OIDC plugin."""
    log_info("Configuring APISIX gateway...")
    
    headers = {
        "X-API-KEY": APISIX_API_KEY,
        "Content-Type": "application/json"
    }
    
    # Configure bypass routes for Kratos/Hydra paths
    bypass_routes = [
        (100, "/.well-known/*", "hydra-wellknown", "hydra:4444"),
        (101, "/oauth2/*", "hydra-oauth2", "hydra:4444"),
        (102, "/oidc/*", "hydra-oidc", "hydra:4444"),
        (103, "/kratos/*", "kratos-public", "kratos:4433"),
        (104, "/self-service/*", "kratos-selfservice", "kratos:4433"),
        (105, "/identities/*", "kratos-identities", "kratos:4433"),
        (106, "/sessions/*", "kratos-sessions", "kratos:4433"),
        (107, "/login", "kratos-ui-login", "kratos-ui:4455"),
        (108, "/registration", "kratos-ui-reg", "kratos-ui:4455"),
        (109, "/settings", "kratos-ui-settings", "kratos-ui:4455"),
        (110, "/recovery", "kratos-ui-recovery", "kratos-ui:4455"),
        (111, "/verification", "kratos-ui-verify", "kratos-ui:4455"),
        (112, "/error", "kratos-ui-error", "kratos-ui:4455"),
        (113, "/consent", "kratos-ui-consent", "kratos-ui:4455"),
        (114, "/logout", "kratos-ui-logout", "kratos-ui:4455"),
    ]
    
    for rid, uri, name, upstream in bypass_routes:
        try:
            requests.put(
                f"{APISIX_ADMIN_URL}/apisix/admin/routes/{rid}",
                headers=headers,
                json={
                    "uri": uri,
                    "name": name,
                    "priority": 100,
                    "upstream": {
                        "type": "roundrobin",
                        "nodes": {upstream: 1}
                    }
                },
                timeout=10
            )
        except Exception as e:
            log_warn(f"Failed to create route {name}: {e}")
    
    log_info("Bypass routes configured")
    
    # Configure OIDC protected route for /api
    log_info("Configuring OIDC protected route for /api...")
    
    oidc_config = {
        "uri": "/api/*",
        "name": "api-oidc",
        "priority": 10,
        "plugins": {
            "openid-connect": {
                "client_id": client_id,
                "client_secret": client_secret,
                "discovery": f"{HYDRA_PUBLIC_URL}/.well-known/openid-configuration",
                "scope": "openid profile email",
                "bearer_only": False,
                "redirect_uri": REDIRECT_URI,
                "post_logout_redirect_uri": POST_LOGOUT_URI,
                "session": {
                    "secret": SESSION_SECRET
                }
            }
        },
        "upstream": {
            "type": "roundrobin",
            "nodes": {"backend:8080": 1}
        }
    }
    
    try:
        r = requests.put(
            f"{APISIX_ADMIN_URL}/apisix/admin/routes/10",
            headers=headers,
            json=oidc_config,
            timeout=10
        )
        if r.status_code in [200, 201]:
            log_info("OIDC route configured")
            return True
        else:
            log_error(f"Failed to configure OIDC route: {r.status_code} - {r.text}")
    except Exception as e:
        log_error(f"Failed to configure OIDC route: {e}")
    
    return False

def clean_gateway():
    """Remove APISIX routes."""
    log_info("Removing APISIX routes...")
    headers = {"X-API-KEY": APISIX_API_KEY}
    route_ids = [10, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]
    for rid in route_ids:
        try:
            requests.delete(
                f"{APISIX_ADMIN_URL}/apisix/admin/routes/{rid}",
                headers=headers,
                timeout=10
            )
        except:
            pass
    log_info("Gateway routes removed")

def clean_local():
    """Remove local files."""
    log_info("Removing local files...")
    if CREDENTIALS_FILE.exists():
        CREDENTIALS_FILE.unlink()
    log_info("Local files removed")

def bootstrap():
    """Run the bootstrap process."""
    if not check_hydra_health():
        log_error("Hydra is not available. Make sure to run 'make up' first.")
        sys.exit(1)
    
    if not check_kratos_health():
        log_error("Kratos is not available. Make sure to run 'make up' first.")
        sys.exit(1)
    
    client_id, client_secret = create_oauth2_client()
    if not client_id:
        log_error("Failed to create OAuth2 client")
        sys.exit(1)
    
    save_credentials(client_id, client_secret)
    
    # Update standalone config for non-etcd mode
    update_standalone_config(client_id, client_secret)
    
    if not configure_apisix(client_id, client_secret):
        log_error("Failed to configure APISIX")
        sys.exit(1)
    
    log_info("Bootstrap complete!")
    print(f"\nClient ID: {client_id}")
    print(f"Client Secret: {client_secret}")
    print(f"\nOIDC Discovery: {HYDRA_PUBLIC_URL}/.well-known/openid-configuration")
    print(f"Login UI: http://localhost:4455/login")

def down():
    """Clean up bootstrap."""
    clean_gateway()
    restore_standalone_config()
    clean_local()
    log_info("Cleanup complete!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python bootstrap.py [bootstrap|down]")
        sys.exit(1)
    
    if sys.argv[1] == "bootstrap":
        bootstrap()
    elif sys.argv[1] == "down":
        down()
    else:
        print(f"Unknown command: {sys.argv[1]}")
        sys.exit(1)
