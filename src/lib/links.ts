/**
 * UBC's own Workday alias, which redirects to the current tenant host
 * (wd10.myworkday.com/ubc at time of writing). Linking the alias rather than
 * the tenant means a tenant migration doesn't break every prompt that points
 * a student at their course export.
 */
export const UBC_WORKDAY_URL = 'https://myworkday.ubc.ca';
