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

export function login(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const payload = session.getIdToken().decodePayload()
        resolve({
          email: payload.email,
          role: payload['custom:custom:role'] || 'member',
          memberId: payload['custom:custom:memberId'] || '',
          token: session.getIdToken().getJwtToken(),
        })
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: (userAttributes) => {
        // Handle forced password change (shouldn't happen with permanent passwords)
        delete userAttributes.email_verified
        delete userAttributes.email
        user.completeNewPasswordChallenge(password, userAttributes, {
          onSuccess: (session) => {
            const payload = session.getIdToken().decodePayload()
            resolve({
              email: payload.email,
              role: payload['custom:custom:role'] || 'member',
              memberId: payload['custom:custom:memberId'] || '',
              token: session.getIdToken().getJwtToken(),
            })
          },
          onFailure: (err) => reject(err),
        })
      },
    })
  })
}

export function logout() {
  const user = userPool.getCurrentUser()
  if (user) user.signOut()
}

export function getCurrentSession() {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser()
    if (!user) return resolve(null)
    user.getSession((err, session) => {
      if (err || !session?.isValid()) return resolve(null)
      const payload = session.getIdToken().decodePayload()
      resolve({
        email: payload.email,
        role: payload['custom:custom:role'] || 'member',
        memberId: payload['custom:custom:memberId'] || '',
        token: session.getIdToken().getJwtToken(),
      })
    })
  })
}
