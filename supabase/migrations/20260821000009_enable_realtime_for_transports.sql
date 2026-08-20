-- Enable Supabase Realtime for notify_transports so frontend UI updates automatically
alter publication supabase_realtime add table public.notify_transports;
alter table public.notify_transports replica identity full;
