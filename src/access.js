import { TeamMemberMembershipState, TeamMemberRole } from 'discord.js';

// Whoever owns the application on Discord or, if a team does, its owner and the admins
// who've accepted their invite. Asks Discord rather than a setting, so there's nothing
// to get wrong, and if the question fails the command fails with it.
export async function isBotAdmin(client, userId) {
  const { owner } = await client.application.fetch();
  if (userId === (owner?.ownerId ?? owner?.id)) return true;

  const member = owner?.members?.get(userId);
  return (
    member?.role === TeamMemberRole.Admin &&
    member.membershipState === TeamMemberMembershipState.Accepted
  );
}
