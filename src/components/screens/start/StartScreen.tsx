import { useProjectHistory } from "@/lib/history.queries";
import { useLoadProject, useLoadProjectFromPath, useCreateProject } from "@/lib/project.queries";
import { useCurrentProject } from "@/state/currentProjectStore.tsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useState, useCallback } from "react";
import { ProjectHistoryEntry } from "@/lib/schemas";
import logo from "@/assets/soundsbored-logo-moshed.gif";

export function StartScreen() {
  const { data: recentProjects = [], isLoading, error } = useProjectHistory();
  const { setCurrentProject } = useCurrentProject();
  const loadProjectMutation = useLoadProject();
  const loadProjectFromPathMutation = useLoadProjectFromPath();
  const createProjectMutation = useCreateProject();
  const navigate = useNavigate();
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // Common logic for navigating to main page after loading/creating a project
  const navigateToProject = useCallback((result: { project: { name: string }, folderPath: string }, isTemporary: boolean) => {
    setCurrentProject(
      {
        name: result.project.name,
        path: result.folderPath,
        date: new Date().toISOString(),
      },
      result.project,
      isTemporary
    );
    navigate("/main");
  }, [setCurrentProject, navigate]);

  const handleLoad = async (entry: ProjectHistoryEntry) => {
    try {
      const result = await loadProjectFromPathMutation.mutateAsync(entry.path);
      if (result) {
        navigateToProject(result, false); // Existing projects are in permanent locations
      }
    } catch (error) {
      console.error("Failed to load project:", error);
    }
  };

  const handleLoadProject = async () => {
    const result = await loadProjectMutation.mutateAsync();
    if (result) {
      navigateToProject(result, false); // Existing projects are in permanent locations
    }
  };

  const handleCreateProject = async () => {
    setIsCreatingProject(true);

    try {
      const result = await createProjectMutation.mutateAsync(undefined);
      navigateToProject(result, true); // New projects start in temporary location
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen backdrop-blur-xs">
      <img src={logo} alt="Sounds Bored Logo" className="mb-8 w-48" style={{filter: "drop-shadow(6px 8px 0px #000000)"}} />
      <h1 className="text-center mb-8 logo tracking-widest text-4xl" style={{color: "var(--secondary)", filter: "drop-shadow(6px 8px 0px #000000)"}}>
        SOUNDS BORED
      </h1>
      <Card className="w-full max-w-md shadowed">
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button
              variant="default"
              className="w-full"
              onClick={handleCreateProject}
              disabled={isCreatingProject || createProjectMutation.isPending}
            >
              {isCreatingProject || createProjectMutation.isPending ? "Creating..." : "Create New Project"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleLoadProject}
              disabled={loadProjectMutation.isPending}
            >
              {loadProjectMutation.isPending ? "Loading..." : "Load Project"}
            </Button>
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Recent Projects</h3>
              {isLoading && <div>Loading...</div>}
              {error && <div className="text-red-500">{error.message}</div>}
              {recentProjects.length === 0 && !isLoading && <div>No recent projects found.</div>}
              <ul className="space-y-2">
                {recentProjects.map((entry) => (
                  <li key={entry.path} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{entry.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{new Date(entry.date).toLocaleString()}</span>
                    </span>
                    <Button size="sm" onClick={() => handleLoad(entry)}>Load</Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
