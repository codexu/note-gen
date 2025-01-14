import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function NoData() {
  const router = useRouter();

  function handelRouteToSetting() {
    router.push('/core/setting?anchor=sync', { scroll: false });
  }

  return (
    <div className="p-4 flex flex-col gap-4 text-secondary-foreground">
      <h1 className="text-2xl font-bold">同步功能未开启</h1>
      <p className="text-sm">请先跳转至系统设置页面，配置 Github 同步。</p>
      <div className="flex gap-2">
        <Button onClick={handelRouteToSetting}>
          前往设置
        </Button>
        <Button variant={'outline'}>
          如何使用同步功能？
        </Button>
      </div>
    </div>
  )
}