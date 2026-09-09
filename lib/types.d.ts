export interface GroupActionPlan {
    action: string;
    groupId: string;
    targetId?: string;
    reason?: string;
}
export interface ActionResult {
    ok: boolean;
    message: string;
    plan?: GroupActionPlan;
}
export type MemberRole = 'owner' | 'admin' | 'member';
export interface AuthorizationResult {
    ok: boolean;
    message: string;
    userMessage?: string;
}
export interface MuteParseResult {
    ok: boolean;
    targetId: string;
    minutes: number;
    message: string;
}
