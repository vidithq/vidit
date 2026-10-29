export type Account =
  | { kind: "analyst"; username: string; avatar_url?: string | null }
  | { kind: "organization"; slug: string; name: string; avatar_url?: string | null };

export function analystAccount(ref: { username: string; avatar_url?: string | null }): Account {
  return { kind: "analyst", username: ref.username, avatar_url: ref.avatar_url };
}

export function accountName(account: Account): string {
  return account.kind === "analyst" ? account.username : account.name;
}

export function accountKey(account: Account): string {
  return account.kind === "analyst" ? `analyst:${account.username}` : `organization:${account.slug}`;
}
