import { TeamMemberMembershipState, TeamMemberRole } from 'discord.js';

// Whoever owns the application on Discord or, if a team does, its owner and the admins
// who've accepted their invite. Asks Discord rather than a setting, so there's nothing
// to get wrong, and if the question fails the caller fails with it.
export async function botAdminIds(client) {
  const { owner } = await client.application.fetch();
  const ids = new Set();
  const ownerId = owner?.ownerId ?? owner?.id; // a team's owner, or the one person
  if (ownerId) ids.add(ownerId);
  for (const [id, member] of owner?.members ?? []) {
    if (
      member.role === TeamMemberRole.Admin &&
      member.membershipState === TeamMemberMembershipState.Accepted
    )
      ids.add(id);
  }
  return [...ids];
}

export async function isBotAdmin(client, userId) {
  return (await botAdminIds(client)).includes(userId);
}
