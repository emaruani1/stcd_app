import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js'

const POOL_ID = import.meta.env.VITE_COGNITO_POOL_ID
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID

const userPool = new CognitoUserPool({
  UserPoolId: POOL_ID,
  ClientId: CLIENT_ID,
})

const normalizeEmail = (email) => (email || '').trim().toLowerCase()

const sessionFromCognitoSession = (session) => {
  const payload = session.getIdToken().decodePayload()
  return {
    email: payload.email,
    role: payload['custom:custom:role'] || 'member',
    memberId: payload['custom:custom:memberId'] || '',
    token: session.getIdToken().getJwtToken(),
  }
}

/**
 * Begin sign-in. Resolves with either a session or a challenge object the UI
 * must complete:
 *   { kind: 'session', session }
 *   { kind: 'newPassword', complete: (newPassword) => Promise<session> }
 *   { kind: 'mfa', verify: (code) => Promise<session> }
 */
export function login(email, password) {
  const username = normalizeEmail(email)
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: userPool })
    const authDetails = new AuthenticationDetails({ Username: username, Password: password })

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({ kind: 'session', session: sessionFromCognitoSession(session) })
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: (userAttributes) => {
        // First-time sign-in. The UI will collect a brand-new password and
        // call complete() — we never reuse the temp password.
        delete userAttributes.email_verified
        delete userAttributes.email
        resolve({
          kind: 'newPassword',
          complete: (newPassword) => new Promise((res, rej) => {
            user.completeNewPasswordChallenge(newPassword, userAttributes, {
              onSuccess: (session) => res(sessionFromCognitoSession(session)),
              onFailure: (e) => rej(e),
            })
          }),
        })
      },
      totpRequired: () => {
        resolve({
          kind: 'mfa',
          verify: (code) => new Promise((res, rej) => {
            user.sendMFACode(code, {
              onSuccess: (session) => res(sessionFromCognitoSession(session)),
              onFailure: (e) => rej(e),
            }, 'SOFTWARE_TOKEN_MFA')
          }),
        })
      },
    })
  })
}

export function logout() {
  const user = userPool.getCurrentUser()
  if (user) user.signOut()
}

export function forgotPassword(email) {
  const username = normalizeEmail(email)
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: userPool })
    user.forgotPassword({
      onSuccess: (data) => resolve(data),
      onFailure: (err) => reject(err),
    })
  })
}

export function confirmNewPassword(email, code, newPassword) {
  const username = normalizeEmail(email)
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: userPool })
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    })
  })
}

export function getCurrentSession() {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser()
    if (!user) return resolve(null)
    user.getSession((err, session) => {
      if (err || !session?.isValid()) return resolve(null)
      resolve(sessionFromCognitoSession(session))
    })
  })
}

/** Resolve to a CognitoUser bound to a valid session, or reject. */
function getAuthedUser() {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser()
    if (!user) return reject(new Error('Not signed in'))
    user.getSession((err, session) => {
      if (err || !session?.isValid()) return reject(err || new Error('Session expired'))
      resolve(user)
    })
  })
}

/** Change password for the currently signed-in user. */
export async function changePassword(oldPassword, newPassword) {
  const user = await getAuthedUser()
  return new Promise((resolve, reject) => {
    user.changePassword(oldPassword, newPassword, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/**
 * Begin TOTP setup. Returns { secret, otpauthUri } the UI can render as a
 * QR code. The user scans with an authenticator app and confirms with verifyMfa.
 */
export async function setupMfa() {
  const user = await getAuthedUser()
  const secret = await new Promise((resolve, reject) => {
    user.associateSoftwareToken({
      associateSecretCode: (code) => resolve(code),
      onFailure: (err) => reject(err),
    })
  })
  // Decoding the JWT to grab the email for the otpauth label
  const session = await getCurrentSession()
  const issuer = 'STCD Member Portal'
  const account = session?.email || 'user'
  const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
  return { secret, otpauthUri }
}

/** Confirm TOTP setup by submitting the first 6-digit code. Marks TOTP as preferred. */
export async function verifyMfa(code, deviceName = 'Authenticator app') {
  const user = await getAuthedUser()
  await new Promise((resolve, reject) => {
    user.verifySoftwareToken(code, deviceName, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    })
  })
  await new Promise((resolve, reject) => {
    user.setUserMfaPreference(null, { PreferredMfa: true, Enabled: true }, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/** Turn off TOTP for the current user. */
export async function disableMfa() {
  const user = await getAuthedUser()
  return new Promise((resolve, reject) => {
    user.setUserMfaPreference(null, { PreferredMfa: false, Enabled: false }, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/** Returns 'TOTP' if the user has TOTP MFA active, otherwise 'NONE'. */
export async function getMfaStatus() {
  const user = await getAuthedUser()
  return new Promise((resolve, reject) => {
    user.getUserData((err, data) => {
      if (err) return reject(err)
      const settings = data?.UserMFASettingList || []
      resolve(settings.includes('SOFTWARE_TOKEN_MFA') ? 'TOTP' : 'NONE')
    }, { bypassCache: true })
  })
}
