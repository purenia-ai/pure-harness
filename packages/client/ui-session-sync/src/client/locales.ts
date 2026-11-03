/** `sessionSync` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sessionSync'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.title': '同步会话到服务器',
  'settings.description': '聊天过程中把会话归档到 PureHub；可随时关闭，历史会话不回填',
  'settings.reasoningTitle': '上传思考内容',
  'settings.reasoningDescription': '把模型的思考过程一并以【思考】段落归档',
  'menu.synced': '同步已开',
  'menu.paused': '同步已停',
}

/** Dictionary key set. */
export type SyncKey = keyof typeof zh

/** English dictionary. */
export const en: Record<SyncKey, string> = {
  'settings.title': 'Sync sessions to the server',
  'settings.description': 'Archive sessions to PureHub while you chat; turn it off at any time. Earlier sessions are not backfilled.',
  'settings.reasoningTitle': 'Upload reasoning',
  'settings.reasoningDescription': 'Archive model reasoning as a [Thinking] section.',
  'menu.synced': 'Sync on',
  'menu.paused': 'Sync off',
}

/** Japanese dictionary. */
export const ja: Record<SyncKey, string> = {
  'settings.title': 'セッションをサーバーへ同期',
  'settings.description': '会話中にセッションを PureHub へ保存します。いつでも停止できます。過去のセッションは遡りません。',
  'settings.reasoningTitle': '思考内容をアップロード',
  'settings.reasoningDescription': 'モデルの思考を【思考】段落として保存します。',
  'menu.synced': '同期オン',
  'menu.paused': '同期オフ',
}

/** Spanish dictionary. */
export const es: Record<SyncKey, string> = {
  'settings.title': 'Sincronizar sesiones con el servidor',
  'settings.description': 'Archiva las sesiones en PureHub mientras conversas; puedes desactivarlo cuando quieras. Las sesiones anteriores no se rellenan.',
  'settings.reasoningTitle': 'Subir razonamiento',
  'settings.reasoningDescription': 'Archiva el razonamiento del modelo como una sección [Pensamiento].',
  'menu.synced': 'Sincronización activa',
  'menu.paused': 'Sincronización pausada',
}

/** French dictionary. */
export const fr: Record<SyncKey, string> = {
  'settings.title': 'Synchroniser les sessions avec le serveur',
  'settings.description': 'Archivez les sessions dans PureHub pendant la conversation ; désactivable à tout moment. Les sessions passées ne sont pas reprises.',
  'settings.reasoningTitle': 'Envoyer le raisonnement',
  'settings.reasoningDescription': 'Archive le raisonnement du modèle dans une section 【Réflexion】.',
  'menu.synced': 'Synchro active',
  'menu.paused': 'Synchro en pause',
}

/** German dictionary. */
export const de: Record<SyncKey, string> = {
  'settings.title': 'Sitzungen mit dem Server synchronisieren',
  'settings.description': 'Archiviert Sitzungen während des Chats in PureHub; jederzeit abschaltbar. Frühere Sitzungen werden nicht nachgetragen.',
  'settings.reasoningTitle': 'Denkprozess hochladen',
  'settings.reasoningDescription': 'Archiviert den Denkprozess des Modells als 【Denken】-Abschnitt.',
  'menu.synced': 'Sync aktiv',
  'menu.paused': 'Sync pausiert',
}

/** Russian dictionary. */
export const ru: Record<SyncKey, string> = {
  'settings.title': 'Синхронизировать сессии с сервером',
  'settings.description': 'Архивирует сессии в PureHub во время беседы; можно отключить в любой момент. Прошлые сессии не загружаются.',
  'settings.reasoningTitle': 'Загружать рассуждения',
  'settings.reasoningDescription': 'Архивирует рассуждения модели как раздел 【Размышление】.',
  'menu.synced': 'Синхронизация включена',
  'menu.paused': 'Синхронизация приостановлена',
}

/** Portuguese dictionary. */
export const pt: Record<SyncKey, string> = {
  'settings.title': 'Sincronizar sessões com o servidor',
  'settings.description': 'Arquiva as sessões no PureHub durante a conversa; pode desativar a qualquer momento. Sessões anteriores não são preenchidas.',
  'settings.reasoningTitle': 'Enviar raciocínio',
  'settings.reasoningDescription': 'Arquiva o raciocínio do modelo como uma seção 【Pensamento】.',
  'menu.synced': 'Sincronização ativa',
  'menu.paused': 'Sincronização pausada',
}
