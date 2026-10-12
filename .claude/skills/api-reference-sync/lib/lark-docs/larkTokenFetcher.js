const fetch = require('node-fetch')
const process = require('node:process')
require('dotenv').config()

// The doc-writing app owns the bitable/drive scopes; the messaging app
// (BOT_*) deliberately does not. Passing no args means the doc chain —
// messaging consumers must pass { appIdEnv: 'BOT_APP_ID', ... } explicitly.
const DEFAULT_APP_ID_ENV = 'DOC_APP_ID'
const DEFAULT_APP_SECRET_ENV = 'DOC_APP_SECRET'
const FEISHU_HOST = process.env.FEISHU_HOST

class larkTokenFetcher {

    constructor (options = {}) {
        this.appIdEnv = options.appIdEnv || DEFAULT_APP_ID_ENV
        this.appSecretEnv = options.appSecretEnv || DEFAULT_APP_SECRET_ENV
        this.tenantAccessToken = undefined
        this.tenantAccessTokenExpireTime = undefined
    }

    resolveCredentials () {
        const appId = process.env[this.appIdEnv]
        const appSecret = process.env[this.appSecretEnv]
        if (!appId || !appSecret) {
            throw new Error(`${this.appIdEnv}/${this.appSecretEnv} missing from env — Feishu auth is fail-closed without them`)
        }
        return { appId, appSecret }
    }

    async fetchToken() {
        const { appId, appSecret } = this.resolveCredentials()

        const req = {
            method: 'post',
            body: JSON.stringify({
                "app_id": appId,
                "app_secret": appSecret
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        let res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal/`, req)

        res = await res.json()

        if (res.code == 0) {
            this.tenantAccessToken = res.tenant_access_token
            this.tenantAccessTokenExpireTime = Date.now() + res.expire
        } else {
            throw new Error(`tenant_access_token fetch failed for ${this.appIdEnv}: ${res.code} ${res.msg}`)
        }
    }

    async token () {
        if (!this.tenantAccessToken || this.tenantAccessTokenExpireTime - Date.now() < 30) {
            await this.fetchToken()
        }

        return this.tenantAccessToken
    }
}

module.exports = larkTokenFetcher
