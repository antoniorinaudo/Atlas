module.exports = async function readChannel(client, invite) {
  return client.pupPage.evaluate(async invite => {
    const metadata = await window.require('WAWebNewsletterMetadataQueryJob').queryNewsletterMetadataByInviteCode(invite);
    if (metadata.newsletterInviteLinkMetadataMixin?.inviteCode !== invite || metadata.newsletterVerificationMetadataMixin?.verificationState !== 'verified') throw Error('Canal oficial no verificado');
    await window.require('WAWebLoadNewsletterPreviewChatAction').loadNewsletterPreviewChat(metadata.idJid);
    const channel = await window.WWebJS.getChat(metadata.idJid, {getAsModel: false});
    if (!channel || !metadata.idJid.endsWith('@newsletter')) throw Error('Canal no disponible');
    let records = channel.msgs.getModelsArray();
    // The server's preview includes recent reports. Recover older public posts
    // only when needed to cover yesterday; never enumerate personal chats.
    const cutoff = Math.floor((Date.now() - 18000000) / 86400000) * 86400 + 18000 - 86400;
    let historyLimited = false;
    for (let attempt = 0; attempt < 8 && records.length < 500 && (!records.length || records[0].t > cutoff); attempt++) {
      const before = records.length;
      try {await window.require('WAWebChatLoadMessages').loadEarlierMsgs({chat: channel});}
      catch {historyLimited = true;}
      records = channel.msgs.getModelsArray();
      if (records.length <= before) break;
    }
    return {name: metadata.newsletterNameMetadataMixin.nameElementValue,
      history_limited: historyLimited,
      messages: records.filter(m => !m.isNotification && m.type !== 'newsletter_notification').slice(-500).map(m => ({
        id: m.id.id, message_key: m.id._serialized,
        published_at_utc: new Date(m.t * 1000).toISOString(),
        text: String(m.caption || (m.type === 'chat' ? m.body : '') || '').slice(0, 16000),
        has_media: m.type === 'image'
      }))};
  }, invite);
};
