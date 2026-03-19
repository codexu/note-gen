export function shouldEmitOrganizeOnboardingComplete({
  streamFinished,
  aborted,
}: {
  streamFinished: boolean
  aborted: boolean
}) {
  return streamFinished && !aborted
}
