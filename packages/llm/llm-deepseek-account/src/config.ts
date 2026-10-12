/** Account providers expose protocol settings without an API-key reference. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepSeekConfigFields } from '@deepseek-ai/dsh-llm-deepseek'
import type { Config as ProtocolConfig } from '@deepseek-ai/dsh-llm-deepseek'

/** Account route configuration; authentication comes exclusively from the account service. */
export interface Config extends ProtocolConfig {
  /**
   * Request header carrying the account token: `x-dsh-auth-token` (default) sends the token
   * verbatim as `x-dsh-auth-token`; `bearer` sends `Authorization: Bearer <token>`.
   */
  authScheme: Volatile<'x-dsh-auth-token' | 'bearer' | undefined>
}

export const Config = z.object({
  ...deepSeekConfigFields,
  authScheme: z.union(['x-dsh-auth-token', 'bearer']).volatile(),
})
