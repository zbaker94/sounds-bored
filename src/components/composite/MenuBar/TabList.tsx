import { TabsList, TabsTrigger } from "@/components/ui/tabs"

const tabs: { id: string; title: string }[] = []

export const TabList = () => {
    // TODO get scenes from store provider and map them to tabs
    return (
        <TabsList>
            {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                    {tab.title}
                </TabsTrigger>
            ))}
        </TabsList>
    )
}